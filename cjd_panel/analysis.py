"""Indicadores descriptivos calculados con todas las lecturas, no con la gráfica reducida."""
from datetime import datetime
import hashlib
import json


def curve_key(segments):
    if len(segments) != 20:
        return None
    signature = [[None if i == 0 else s['temperature'], s['minutes']] for i, s in enumerate(segments)]
    return hashlib.sha256(json.dumps(signature, separators=(',', ':')).encode()).hexdigest()


def summarize(rows):
    result = {'samples': len(rows), 'pv_max': None, 'pv_min': None, 'sv_max': None,
              'mean_abs_deviation': None, 'mean_deviation': None, 'duration_seconds': None,
              'continuity_percent': None, 'gaps': 0, 'duplicate_or_reversed': 0, 'segments': []}
    if not rows:
        return result
    span = (datetime.fromisoformat(rows[-1]['timestamp']) - datetime.fromisoformat(rows[0]['timestamp'])).total_seconds()
    result.update(pv_max=max(r['pv'] for r in rows), pv_min=min(r['pv'] for r in rows),
                  sv_max=max(r['sv'] for r in rows), duration_seconds=max(0, span),
                  mean_abs_deviation=sum(abs(r['pv'] - r['sv']) for r in rows)/len(rows),
                  mean_deviation=sum(r['pv'] - r['sv'] for r in rows)/len(rows))
    groups = {}
    coverage = 0
    previous = None
    for r in rows:
        key = (r['memory'], r['step'])
        group = groups.setdefault(key, {'memory': r['memory'], 'step': r['step'], 'samples': 0,
            'observed_seconds': 0, 'pv_min': r['pv'], 'pv_max': r['pv'], 'mean_abs_deviation': 0, 'mean_deviation': 0})
        group['samples'] += 1
        group['pv_min'] = min(group['pv_min'], r['pv'])
        group['pv_max'] = max(group['pv_max'], r['pv'])
        group['mean_abs_deviation'] += abs(r['pv'] - r['sv'])
        group['mean_deviation'] += r['pv'] - r['sv']
        if previous is not None:
            dt = (datetime.fromisoformat(r['timestamp']) - datetime.fromisoformat(previous['timestamp'])).total_seconds()
            if 0 < dt <= 5:
                coverage += dt
                if (previous['memory'], previous['step']) == key:
                    group['observed_seconds'] += dt
            elif dt > 5:
                result['gaps'] += 1
            else:
                result['duplicate_or_reversed'] += 1
        previous = r
    for key in sorted(groups):
        g = groups[key]
        g['mean_abs_deviation'] /= g['samples']
        g['mean_deviation'] /= g['samples']
        result['segments'].append(g)
    result['continuity_percent'] = min(100,100 * coverage/span) if span > 0 else None
    return result


def chart_data(rows, reduced=False):
    """Metadatos de todas las lecturas; reducir trazado sin ocultar huecos o tramos."""
    marks, gaps, pauses, groups = [], [], [], []
    boundaries = set()
    previous = None
    group = 0
    paused_at = None
    for i, row in enumerate(rows):
        if previous is None or (row['memory'], row['step']) != (previous['memory'], previous['step']):
            marks.append({k: row[k] for k in ('timestamp', 'memory', 'step')})
        if previous is not None:
            dt = (datetime.fromisoformat(row['timestamp']) - datetime.fromisoformat(previous['timestamp'])).total_seconds()
            if dt <= 0 or dt > 5:
                group += 1
                boundaries.update((i-1, i))
                gaps.append({'start': previous['timestamp'], 'end': row['timestamp'], 'seconds': dt})
        groups.append(group)
        # PAUSA explícita en el estado registrado; nunca deducida de SV estable.
        if row['state'] == 2 and paused_at is None:
            paused_at = row['timestamp']
        elif row['state'] != 2 and paused_at is not None:
            pauses.append({'start': paused_at, 'end': row['timestamp'], 'open': False})
            paused_at = None
        previous = row
    if paused_at is not None:
        pauses.append({'start': paused_at, 'end': rows[-1]['timestamp'], 'open': True})
    stride = max(1, (len(rows) + 1999)//2000) if reduced else 1
    indices = set(range(0, len(rows), stride)) | boundaries
    if rows:
        indices.add(len(rows)-1)
    readings = [{**rows[i], 'plot_group': groups[i]} for i in sorted(indices)]
    return readings, {'segments': marks, 'gaps': gaps, 'pauses': pauses}
