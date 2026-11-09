import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SeriesPoint } from '../lib/types';

const hhmm = (ts: number) => new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

export default function ActivityChart({ series }: { series: SeriesPoint[] }) {
  if (series.length === 0) {
    return <div className="grid h-56 place-items-center text-sm text-slate-400">Biểu đồ sẽ hiện khi có dữ liệu</div>;
  }
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="minute" tickFormatter={hhmm} tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={24} />
          <YAxis yAxisId="l" tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
          <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
          <Tooltip
            labelFormatter={(v) => `Phút ${hhmm(Number(v))}`}
            formatter={(value, name) => [new Intl.NumberFormat('vi-VN').format(Number(value)), name]}
            contentStyle={{ borderRadius: 8, fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="l" dataKey="comments" name="Bình luận / phút" fill="#6366f1" radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Line yAxisId="r" dataKey="viewers" name="Người xem" stroke="#f43f5e" strokeWidth={2} dot={false} type="monotone" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
