"""Explicit opt-in fixture. Never overwrites an existing source config or database."""
import argparse
import datetime as dt
import json
import math
import pathlib
import sqlite3

parser = argparse.ArgumentParser()
parser.add_argument('--data-dir', required=True)
parser.add_argument('--create-simulated-data', action='store_true', required=True)
args = parser.parse_args()
root = pathlib.Path(args.data_dir).resolve()
folder = root / 'aiaas-diagnostics'
folder.mkdir(parents=True, exist_ok=True)
dsfolder = root / 'sql-datasources'
dsfolder.mkdir(parents=True, exist_ok=True)
database = folder / 'demo-aiaas.sqlite'
config = folder / 'sources.json'
dsfile = dsfolder / 'demo-aiaas.json'
if any(p.exists() for p in (database, config, dsfile)):
    raise SystemExit('Refusing overwrite: demo/config already exists; inspect existing files first.')
end = dt.datetime.now(dt.timezone.utc).replace(second=0, microsecond=0)
start = end - dt.timedelta(hours=2)
with sqlite3.connect(str(database)) as conn:
    conn.execute('CREATE TABLE readings(ts_ms INTEGER NOT NULL, tag TEXT NOT NULL, value REAL NOT NULL)')
    conn.execute('CREATE INDEX metric_time ON readings(tag,ts_ms)')
    for i in range(120):
        timestamp = int((start + dt.timedelta(minutes=i)).timestamp() * 1000)
        for metric, value in [('nh4n_mg_l', 0.8 + max(0, i - 60) * 0.025),
                              ('do_mg_l', 2.1 - max(0, i - 60) * 0.01 + math.sin(i / 8) * 0.05)]:
            conn.execute('INSERT INTO readings VALUES (?,?,?)', (timestamp, metric, value))
dsfile.write_text(json.dumps({'id': 'demo-aiaas', 'name': 'SIMULATED AIAAS history', 'type': 'sqlite',
    'filePath': str(database), 'host': '', 'port': 0, 'user': '', 'password': '', 'database': '',
    'createdAt': 0, 'updatedAt': 0}), encoding='utf-8')
config.write_text(json.dumps({'version': 1, 'sources': [{'id': 'demo-aiaas',
    'name': 'SIMULATED - not plant data', 'datasourceId': 'demo-aiaas',
    'table': 'readings', 'timeColumn': 'ts_ms', 'metricColumn': 'tag', 'valueColumn': 'value',
    'sampleIntervalSeconds': 60, 'maxRows': 10000, 'maxWindowHours': 24, 'simulated': True,
    'metrics': [{'id': 'nh4n_mg_l', 'unit': 'mg N/L'}, {'id': 'do_mg_l', 'unit': 'mg/L'}]}]}, indent=2), encoding='utf-8')
print(json.dumps({'simulated': True, 'sourceId': 'demo-aiaas', 'metric': 'nh4n_mg_l',
                  'start': (end - dt.timedelta(hours=1)).isoformat(), 'end': end.isoformat(),
                  'baselineStart': start.isoformat(),
                  'baselineEnd': (end - dt.timedelta(hours=1)).isoformat()}, indent=2))
