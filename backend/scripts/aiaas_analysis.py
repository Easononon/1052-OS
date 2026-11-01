"""Bounded, read-only analysis of engineer-approved long-format SQLite copies."""
import datetime as dt
import json
import math
import pathlib
import sqlite3
import statistics
import sys
import time


def milliseconds(text):
    return int(dt.datetime.fromisoformat(text.replace('Z', '+00:00')).timestamp() * 1000)


def analyze(conn, source, metric, start, end):
    low, high = milliseconds(start), milliseconds(end)
    # Identifiers originate in a strict engineer config schema, never an LLM SQL string.
    table, timestamp, tag, value = (f'"{source[k]}"' for k in
                                   ('table', 'timeColumn', 'metricColumn', 'valueColumn'))
    where = f'{tag} = ? AND {timestamp} >= ? AND {timestamp} < ?'
    params = (metric['id'], low, high)
    total = conn.execute(f'SELECT COUNT(*) FROM {table} WHERE {where}', params).fetchone()[0]
    rows = conn.execute(f'SELECT {timestamp}, {value} FROM {table} WHERE {where} '
                        f'ORDER BY {timestamp} LIMIT ?', (*params, source['maxRows'])).fetchall()
    valid = [(t, v) for t, v in rows if isinstance(t, (int, float))
             and isinstance(v, (int, float)) and math.isfinite(t) and math.isfinite(v)]
    interval = source['sampleIntervalSeconds'] * 1000
    expected = math.ceil((high - low) / interval)
    unique_times = sorted({t for t, _ in valid})
    duplicates = len(valid) - len(unique_times)
    # Count occupied nominal slots, so dense duplicate readings cannot mask missing minutes.
    occupied = len({int((t - low) // interval) for t in unique_times})
    missing = max(0, expected - occupied)
    gaps = [b - a for a, b in zip(unique_times, unique_times[1:])]
    tolerance = source.get('samplingToleranceFraction', 0.2)
    irregular = any(abs(gap - interval) > interval * tolerance for gap in gaps)
    truncated = total > len(rows)
    values = [v for _, v in valid]
    count = len(values)
    slope = None
    if len(unique_times) >= 2:
        xs = [(t - low) / 60000 for t, _ in valid]
        slope = statistics.linear_regression(xs, values).slope
    return {
        'start': start, 'end': end, 'interval': '[start,end)', 'count': count,
        'totalRows': total, 'truncated': truncated,
        'complete': bool(count) and not truncated and not missing
                    and not duplicates and not irregular and count == len(rows),
        'expectedSamples': expected, 'missingSlots': missing, 'duplicateTimestamps': duplicates,
        'invalidValues': len(rows) - count, 'coverage': occupied / expected,
        'maximumGapSeconds': max(gaps) / 1000 if gaps else None,
        'irregularSampling': irregular, 'samplingToleranceFraction': tolerance,
        'minimum': min(values) if count else None, 'maximum': max(values) if count else None,
        'mean': statistics.mean(values) if count else None,
        'first': values[0] if count else None, 'last': values[-1] if count else None,
        'delta': values[-1] - values[0] if count else None,
        'slopePerMinute': slope,
        'firstTimestampMs': valid[0][0] if count else None,
        'lastTimestampMs': valid[-1][0] if count else None,
        'aboveWarningCount': sum(v > metric['warningHigh'] for v in values)
                             if 'warningHigh' in metric else None,
        'statisticsScope': 'returned_valid_samples',
    }


def main():
    payload = json.load(sys.stdin)
    source, metric, request = (payload[k] for k in ('source', 'metric', 'input'))
    uri = pathlib.Path(payload['filePath']).resolve(strict=True).as_uri() + '?mode=ro'
    deadline = time.monotonic() + 8
    with sqlite3.connect(uri, uri=True, timeout=1) as conn:
        conn.execute('PRAGMA query_only=ON')
        conn.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        # Read both windows in one snapshot. No CREATE/INSERT/UPDATE/DELETE or SQL from the model.
        conn.execute('BEGIN')
        current = analyze(conn, source, metric, request['start'], request['end'])
        baseline = analyze(conn, source, metric, request['baselineStart'], request['baselineEnd']) \
            if request.get('baselineStart') else None
    change = None
    if baseline and baseline['count'] and current['count']:
        delta = current['mean'] - baseline['mean']
        change = {'meanDelta': delta,
                  'meanPercentChange': delta / abs(baseline['mean']) * 100 if baseline['mean'] else None,
                  'comparable': current['complete'] and baseline['complete']}
    print(json.dumps({'sourceId': source['id'], 'metric': metric['id'], 'unit': metric['unit'],
                      'simulated': source['simulated'], 'direct_control_allowed': False,
                      'current': current, 'baseline': baseline, 'change': change,
                      'limitations': ['Descriptive statistics only; correlation is not causation.',
                                      'Sample mean is not time-weighted. kW must not be reported as kWh.',
                                      'Freshness must be checked against the requested time and source latency.']},
                     allow_nan=False))


if __name__ == '__main__':
    main()
