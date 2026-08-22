import { useState, useMemo } from "react"
import { motion } from "framer-motion"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

interface EquityChartCardProps {
  data?: { time: string, equity: number }[];
}

const MS_PER_DAY = 86_400_000;

const CHART_RANGES = [
  { id: '1D', days: 1 },
  { id: '1W', days: 7 },
  { id: '1M', days: 30 },
  { id: 'ALL', days: null },
] as const;

type ChartRangeId = (typeof CHART_RANGES)[number]['id'];

export function EquityChartCard({ data = [] }: EquityChartCardProps) {
  const [rangeId, setRangeId] = useState<ChartRangeId>('ALL');

  const visibleData = useMemo(() => {
    const range = CHART_RANGES.find((r) => r.id === rangeId);
    if (!range || range.days === null) return data;
    const cutoff = Date.now() - range.days * MS_PER_DAY;
    return data.filter((d) => Date.parse(d.time) >= cutoff);
  }, [data, rangeId]);

  const hasData = visibleData.length > 1;

  // Format date for tooltip
  const formatTooltip = (value: unknown): [string, string] => [`${Number(value).toFixed(2)}%`, 'Equity'];
  const formatLabel = (label: unknown) => {
    try {
      return new Date(String(label)).toLocaleDateString();
    } catch {
      return String(label);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="card p-6 col-span-12"
    >
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="font-medium text-lg">Equity Curve</h3>
          <p className="text-secondary text-sm">Progress per trade</p>
        </div>
        <div className="flex items-center gap-2">
          {CHART_RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRangeId(r.id)}
              className={`text-xs font-medium px-2 py-1 rounded-lg transition-colors ${
                r.id === rangeId
                  ? 'bg-elevated text-primary border border-border shadow-sm py-1.5'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              {r.id}
            </button>
          ))}
        </div>
      </div>
      
      {hasData ? (
        <div className="w-full h-[250px] mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={visibleData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis 
                dataKey="time" 
                tickFormatter={(val) => {
                  const d = new Date(val);
                  return `${d.getMonth()+1}/${d.getDate()}`;
                }} 
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: 'var(--secondary)' }}
                dy={10}
              />
              <YAxis 
                domain={['dataMin - 5', 'dataMax + 5']}
                axisLine={false}
                tickLine={false}
                tickFormatter={(val) => `${val.toFixed(0)}%`}
                tick={{ fontSize: 10, fill: 'var(--secondary)' }}
              />
              <Tooltip 
                contentStyle={{ backgroundColor: 'var(--elevated)', borderColor: 'var(--border)', borderRadius: '8px', fontSize: '12px' }}
                itemStyle={{ color: 'var(--primary)' }}
                formatter={formatTooltip}
                labelFormatter={formatLabel}
              />
              <Area 
                type="monotone" 
                dataKey="equity" 
                stroke="var(--accent)" 
                strokeWidth={2}
                fillOpacity={1} 
                fill="url(#colorEquity)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="relative w-full h-[180px] mt-4 flex flex-col items-center justify-center border border-dashed border-border rounded-xl bg-surface/50">
          <div className="w-12 h-12 bg-elevated rounded-full flex items-center justify-center text-secondary mb-3 shadow-sm">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"></path><path d="m19 9-5 5-4-4-3 3"></path></svg>
          </div>
          <h4 className="text-sm font-medium mb-1">No trade history</h4>
          <p className="text-xs text-secondary max-w-[200px] text-center">Complete your first trade to generate your equity curve.</p>
        </div>
      )}
    </motion.div>
  )
}
