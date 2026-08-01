import { useMemo } from 'react';
import type { EChartsOption, MarkAreaComponentOption } from 'echarts';
import type { ChannelConfig, ChannelStats, SensorReading } from '@/types';
import { channelValue, cpkBand } from '@/lib/spc';
import { EChart } from './EChart';

const STATUS_COLORS: Record<string, string> = {
  warning: 'rgba(240, 173, 78, 0.12)',
  critical: 'rgba(217, 83, 79, 0.16)',
  failed: 'rgba(217, 83, 79, 0.30)',
  // Recovering: improving but not yet stable — calm green, distinct from warning.
  recovering: 'rgba(76, 175, 125, 0.12)',
};

/** Contiguous non-stable spans → shaded markAreas. */
function statusAreas(readings: SensorReading[]): MarkAreaComponentOption['data'] {
  const areas: NonNullable<MarkAreaComponentOption['data']> = [];
  let start: SensorReading | null = null;
  let status = '';
  for (const r of readings) {
    if (r.system_status !== 'stable') {
      if (!start || status !== r.system_status) {
        if (start) {
          areas.push([
            { xAxis: start.timestamp, itemStyle: { color: STATUS_COLORS[status] } },
            { xAxis: r.timestamp },
          ] as never);
        }
        start = r;
        status = r.system_status;
      }
    } else if (start) {
      areas.push([
        { xAxis: start.timestamp, itemStyle: { color: STATUS_COLORS[status] } },
        { xAxis: r.timestamp },
      ] as never);
      start = null;
    }
  }
  if (start && readings.length) {
    areas.push([
      { xAxis: start.timestamp, itemStyle: { color: STATUS_COLORS[status] } },
      { xAxis: readings[readings.length - 1].timestamp },
    ] as never);
  }
  return areas;
}

export function ControlChart({
  cfg,
  stats,
  readings,
}: {
  cfg: ChannelConfig;
  stats: ChannelStats | undefined;
  readings: SensorReading[];
}) {
  const option: EChartsOption = useMemo(() => {
    const data = readings.map((r) => [r.timestamp, channelValue(r, cfg.key)]);
    const markLines = stats
      ? [
          { yAxis: stats.ucl, name: 'UCL', lineStyle: { color: '#e0a83c', type: 'dashed' as const } },
          { yAxis: stats.lcl, name: 'LCL', lineStyle: { color: '#e0a83c', type: 'dashed' as const } },
          { yAxis: cfg.usl, name: 'USL', lineStyle: { color: '#d9534f', type: 'solid' as const } },
          { yAxis: cfg.lsl, name: 'LSL', lineStyle: { color: '#d9534f', type: 'solid' as const } },
        ]
      : [];

    return {
      animation: false,
      grid: { left: 56, right: 16, top: 28, bottom: 44 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'time', axisLabel: { color: '#8b94a7', hideOverlap: true } },
      yAxis: {
        type: 'value',
        scale: true,
        name: cfg.unit,
        axisLabel: { color: '#8b94a7' },
        splitLine: { lineStyle: { color: 'rgba(139,148,167,0.15)' } },
      },
      dataZoom: [
        { type: 'inside' },
        { type: 'slider', height: 18, bottom: 6, borderColor: 'transparent' },
      ],
      series: [
        {
          name: cfg.label,
          type: 'line',
          showSymbol: false,
          connectNulls: false,
          data,
          lineStyle: { width: 1.4, color: '#5aa9e6' },
          markLine: {
            symbol: 'none',
            label: { formatter: '{b}', color: '#8b94a7', position: 'insideEndTop' },
            data: markLines,
          },
          markArea: { silent: true, data: statusAreas(readings) },
        },
      ],
    };
  }, [cfg, stats, readings]);

  const band = cpkBand(stats?.cpk ?? null);
  return (
    <div className="panel chart-panel">
      <div className="panel-head">
        <span className="panel-title">{cfg.label}</span>
        <span className={`cpk-chip cpk-${band}`}>
          Cpk {stats?.cpk != null ? stats.cpk.toFixed(2) : '—'}
        </span>
      </div>
      <EChart option={option} />
    </div>
  );
}
