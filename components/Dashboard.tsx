import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, 
  PieChart, Pie, Cell, AreaChart, Area, ScatterChart, Scatter, Brush
} from 'recharts';
import { AnalysisResult, Dataset, ChartType, ChartConfiguration, ChatMessage, Sheet, AggregationType, PivotConfiguration } from '../types';
import { getSmartColor } from '../utils/dataUtils';
import { streamAskQuestion, generateChartForecast } from '../services/geminiService';
import { 
  Download, Share2, Filter, Lightbulb, TrendingUp, FileText, Send, MessageSquare, Bot, User, Loader2,
  BarChart3, PieChart as PieChartIcon, LineChart as LineChartIcon, ScatterChart as ScatterChartIcon, AreaChart as AreaChartIcon,
  Wand2, Settings2, ChevronDown, Table2, LayoutDashboard, BrainCircuit, Layers, X, Grid3X3, ArrowUpDown, Menu
} from 'lucide-react';

interface DashboardProps {
  dataset: Dataset;
  analysis: AnalysisResult;
  onReset: () => void;
}

// --- Helper for Aggregation ---
const aggregateData = (data: any[], xKey: string, yKey: string, type: AggregationType, groupKey?: string) => {
  const grouped: Record<string, any> = {};

  data.forEach(row => {
    const xVal = row[xKey];
    if (xVal === null || xVal === undefined) return;
    
    // Key for grouping
    const key = String(xVal);

    if (!grouped[key]) {
      grouped[key] = { 
        [xKey]: xVal, 
        count: 0, 
        values: [],
        _raw: []
      };
    }

    const val = Number(row[yKey]) || 0;
    grouped[key].count += 1;
    grouped[key].values.push(val);
    grouped[key]._raw.push(row);

    // Handle secondary grouping (Stacking)
    if (groupKey) {
        const groupVal = row[groupKey] || 'Unknown';
        if (!grouped[key][groupVal]) grouped[key][groupVal] = 0;
        grouped[key][groupVal] += val; // Default to sum for stacks for now
    }
  });

  return Object.values(grouped).map((item: any) => {
    let finalVal = 0;
    const values = item.values;
    
    switch (type) {
      case 'sum': finalVal = values.reduce((a: number, b: number) => a + b, 0); break;
      case 'avg': finalVal = values.reduce((a: number, b: number) => a + b, 0) / values.length; break;
      case 'min': finalVal = Math.min(...values); break;
      case 'max': finalVal = Math.max(...values); break;
      case 'count': finalVal = item.count; break;
    }
    
    // If we are grouping, we keep the breakdown keys, else we assign the metric to yKey
    if (!groupKey) {
        item[yKey] = finalVal;
    }
    
    return item;
  }).sort((a, b) => (a[xKey] > b[xKey] ? 1 : -1));
};

// --- Pivot Table Component ---

const PivotTableBuilder: React.FC<{ sheet: Sheet }> = ({ sheet }) => {
  const [config, setConfig] = useState<PivotConfiguration>({
    rowLabel: sheet.columns[0].name,
    colLabel: '',
    valueField: sheet.columns.find(c => c.type === 'number')?.name || sheet.columns[1]?.name,
    aggregation: 'sum'
  });

  const pivotData = useMemo(() => {
    const rows = new Set<string>();
    const cols = new Set<string>();
    const valueMap = new Map<string, number[]>();

    sheet.rawData.forEach(row => {
       const rKey = String(row[config.rowLabel] || 'N/A');
       const cKey = config.colLabel ? String(row[config.colLabel] || 'N/A') : 'Total';
       const val = Number(row[config.valueField]) || 0;

       rows.add(rKey);
       cols.add(cKey);

       const key = `${rKey}::${cKey}`;
       if (!valueMap.has(key)) valueMap.set(key, []);
       valueMap.get(key)?.push(val);
    });

    const sortedRows = Array.from(rows).sort();
    const sortedCols = Array.from(cols).sort();

    return { sortedRows, sortedCols, valueMap };
  }, [sheet, config]);

  const getAggregatedValue = (values: number[] | undefined) => {
    if (!values || values.length === 0) return '-';
    switch (config.aggregation) {
      case 'sum': return values.reduce((a, b) => a + b, 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
      case 'avg': return (values.reduce((a, b) => a + b, 0) / values.length).toLocaleString(undefined, { maximumFractionDigits: 1 });
      case 'count': return values.length;
      case 'min': return Math.min(...values).toLocaleString();
      case 'max': return Math.max(...values).toLocaleString();
      default: return 0;
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Controls */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 grid grid-cols-2 md:grid-cols-4 gap-4">
             <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Row Labels</label>
                <select className="w-full text-sm border-slate-200 rounded-md p-2" value={config.rowLabel} onChange={e => setConfig({...config, rowLabel: e.target.value})}>
                    {sheet.columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
             </div>
             <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Column Labels</label>
                <select className="w-full text-sm border-slate-200 rounded-md p-2" value={config.colLabel} onChange={e => setConfig({...config, colLabel: e.target.value})}>
                    <option value="">(None)</option>
                    {sheet.columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
             </div>
             <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Values</label>
                <select className="w-full text-sm border-slate-200 rounded-md p-2" value={config.valueField} onChange={e => setConfig({...config, valueField: e.target.value})}>
                    {sheet.columns.filter(c => c.type === 'number').map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
             </div>
             <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Aggregation</label>
                <select className="w-full text-sm border-slate-200 rounded-md p-2 uppercase" value={config.aggregation} onChange={e => setConfig({...config, aggregation: e.target.value as AggregationType})}>
                    <option value="sum">Sum</option>
                    <option value="avg">Average</option>
                    <option value="count">Count</option>
                    <option value="max">Max</option>
                    <option value="min">Min</option>
                </select>
             </div>
        </div>
        
        {/* Table */}
        <div className="flex-1 overflow-auto p-4">
           <table className="min-w-full divide-y divide-slate-200 border border-slate-200">
              <thead className="bg-slate-50">
                 <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-600 uppercase sticky top-0 bg-slate-50">{config.rowLabel}</th>
                    {pivotData.sortedCols.map(col => (
                       <th key={col} className="px-4 py-3 text-right text-xs font-bold text-slate-600 uppercase sticky top-0 bg-slate-50">{col}</th>
                    ))}
                 </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                 {pivotData.sortedRows.map(rowKey => (
                    <tr key={rowKey} className="hover:bg-slate-50">
                       <td className="px-4 py-2 text-sm font-medium text-slate-900 bg-slate-50/30">{rowKey}</td>
                       {pivotData.sortedCols.map(colKey => (
                          <td key={colKey} className="px-4 py-2 text-sm text-slate-600 text-right font-mono">
                             {getAggregatedValue(pivotData.valueMap.get(`${rowKey}::${colKey}`))}
                          </td>
                       ))}
                    </tr>
                 ))}
              </tbody>
           </table>
        </div>
    </div>
  );
};

// --- Interactive Chart Component ---

interface InteractiveChartProps {
  initialConfig: ChartConfiguration;
  sheet: Sheet;
}

const InteractiveChart: React.FC<InteractiveChartProps> = ({ initialConfig, sheet }) => {
  const [config, setConfig] = useState<ChartConfiguration>(initialConfig);
  const [chartType, setChartType] = useState<ChartType>(initialConfig.chartType);
  const [xAxis, setXAxis] = useState<string>(initialConfig.xAxisKey);
  const [yKey, setYKey] = useState<string>(initialConfig.dataKeys[0]);
  const [aggregation, setAggregation] = useState<AggregationType>(initialConfig.aggregation || 'sum');
  const [groupBy, setGroupBy] = useState<string>(initialConfig.groupByKey || '');
  
  const [isForecasting, setIsForecasting] = useState(false);
  const [forecastData, setForecastData] = useState<any[]>([]);

  // Memoize aggregated data
  const processedData = useMemo(() => {
    const baseData = aggregateData(sheet.rawData, xAxis, yKey, aggregation, groupBy || undefined);
    
    if (forecastData.length > 0) {
       const forecastKey = `${yKey}_forecast`;
       const combined = baseData.map(item => ({ ...item, [forecastKey]: null }));
       if (combined.length > 0) combined[combined.length - 1][forecastKey] = combined[combined.length - 1][yKey];
       forecastData.forEach(item => {
         combined.push({
           ...item, [yKey]: null, [forecastKey]: item[yKey], _isForecast: true
         });
       });
       return combined;
    }
    return baseData;
  }, [sheet.rawData, xAxis, yKey, aggregation, groupBy, forecastData]);

  const numberColumns = sheet.columns.filter(c => c.type === 'number');
  const catColumns = sheet.columns.filter(c => c.type === 'string' || c.type === 'date');

  const handleForecast = async () => {
    if (isForecasting) return;
    setIsForecasting(true);
    try {
      const baseForAI = aggregateData(sheet.rawData, xAxis, yKey, aggregation, groupBy || undefined);
      const predictedPoints = await generateChartForecast(baseForAI, xAxis, yKey);
      if (predictedPoints?.length) setForecastData(predictedPoints);
    } catch (e) {
      console.error(e);
    } finally {
      setIsForecasting(false);
    }
  };

  const renderChart = () => {
    const data = processedData; 
    const forecastKey = `${yKey}_forecast`;

    const CommonAxis = () => (
      <>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey={xAxis} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} minTickGap={20} />
        <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(val) => val >= 1000 ? `${(val/1000).toFixed(1)}k` : val} />
        <RechartsTooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }} />
        <Legend wrapperStyle={{ paddingTop: '10px' }}/>
        <Brush dataKey={xAxis} height={20} stroke="#818cf8" fill="#f8fafc" />
      </>
    );

    if (chartType === ChartType.BAR && groupBy) {
       const stackKeys = Array.from(new Set(sheet.rawData.map(r => r[groupBy]))).slice(0, 8); 
       return (
         <ResponsiveContainer width="100%" height={350}>
           <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
             <CommonAxis />
             {stackKeys.map((key: any, idx) => (
                <Bar key={key} dataKey={key} stackId="a" fill={getSmartColor(idx)} name={key} />
             ))}
           </BarChart>
         </ResponsiveContainer>
       );
    }

    switch (chartType) {
      case ChartType.LINE:
      case ChartType.AREA:
        const ChartComponent = chartType === ChartType.AREA ? AreaChart : LineChart;
        const DataComponent = chartType === ChartType.AREA ? Area : Line;
        return (
          <ResponsiveContainer width="100%" height={350}>
            <ChartComponent data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              {chartType === ChartType.AREA && (
                <defs>
                  <linearGradient id={`grad-${yKey}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={getSmartColor(0)} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={getSmartColor(0)} stopOpacity={0}/>
                  </linearGradient>
                </defs>
              )}
              <CommonAxis />
              <DataComponent type="monotone" dataKey={yKey} stroke={getSmartColor(0)} fill={chartType === ChartType.AREA ? `url(#grad-${yKey})` : undefined} strokeWidth={2} name={yKey} activeDot={{ r: 6 }} />
              {forecastData.length > 0 && (
                <DataComponent type="monotone" dataKey={forecastKey} stroke={getSmartColor(0)} strokeDasharray="5 5" fillOpacity={0.1} strokeWidth={2} name="Forecast" dot={{ r: 4, fill: "#fff", stroke: getSmartColor(0) }} />
              )}
            </ChartComponent>
          </ResponsiveContainer>
        );
      case ChartType.PIE:
        return (
          <ResponsiveContainer width="100%" height={350}>
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={2} dataKey={yKey} nameKey={xAxis}>
                {data.map((_, index) => <Cell key={`cell-${index}`} fill={getSmartColor(index)} />)}
              </Pie>
              <RechartsTooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        );
      case ChartType.BAR:
      default:
        return (
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CommonAxis />
              <Bar dataKey={yKey} fill={getSmartColor(0)} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        );
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col h-full hover:shadow-md transition-shadow">
      <div className="p-4 border-b border-slate-100 bg-slate-50/50 rounded-t-xl">
        <div className="flex justify-between items-start mb-4">
           <div>
              <h4 className="font-bold text-slate-800">{config.title}</h4>
              <p className="text-xs text-slate-500">{config.description}</p>
           </div>
           <div className="flex bg-white border border-slate-200 rounded-lg p-1">
              {[ChartType.BAR, ChartType.LINE, ChartType.AREA, ChartType.PIE].map(t => (
                <button key={t} onClick={() => setChartType(t)} className={`p-1.5 rounded-md ${chartType === t ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
                  {t === ChartType.BAR && <BarChart3 size={16} />}
                  {t === ChartType.LINE && <LineChartIcon size={16} />}
                  {t === ChartType.AREA && <AreaChartIcon size={16} />}
                  {t === ChartType.PIE && <PieChartIcon size={16} />}
                </button>
              ))}
           </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="relative">
                <select className="w-full text-xs pl-2 pr-6 py-1.5 bg-white border border-slate-200 rounded-md appearance-none focus:border-indigo-500 outline-none" value={xAxis} onChange={e => setXAxis(e.target.value)}>
                   {sheet.columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                <label className="absolute -top-2 left-2 bg-white px-1 text-[10px] text-slate-400">X-Axis</label>
            </div>
            <div className="relative">
                <select className="w-full text-xs pl-2 pr-6 py-1.5 bg-white border border-slate-200 rounded-md appearance-none focus:border-indigo-500 outline-none" value={yKey} onChange={e => setYKey(e.target.value)}>
                   {numberColumns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                <label className="absolute -top-2 left-2 bg-white px-1 text-[10px] text-slate-400">Y-Axis</label>
            </div>
            <div className="relative">
                <select className="w-full text-xs pl-2 pr-6 py-1.5 bg-white border border-slate-200 rounded-md appearance-none focus:border-indigo-500 outline-none uppercase" value={aggregation} onChange={e => setAggregation(e.target.value as AggregationType)}>
                   <option value="sum">Sum</option>
                   <option value="avg">Avg</option>
                   <option value="max">Max</option>
                   <option value="min">Min</option>
                   <option value="count">Count</option>
                </select>
                <label className="absolute -top-2 left-2 bg-white px-1 text-[10px] text-slate-400">Aggr</label>
            </div>
            <div className="relative">
                <select className="w-full text-xs pl-2 pr-6 py-1.5 bg-white border border-slate-200 rounded-md appearance-none focus:border-indigo-500 outline-none" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
                   <option value="">None</option>
                   {catColumns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                <label className="absolute -top-2 left-2 bg-white px-1 text-[10px] text-slate-400">Stack By</label>
            </div>
        </div>

        {(chartType === ChartType.LINE || chartType === ChartType.AREA) && (
            <button onClick={handleForecast} disabled={isForecasting || forecastData.length > 0 || !!groupBy} className="mt-3 w-full flex items-center justify-center gap-2 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors disabled:opacity-50">
                {isForecasting ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                {forecastData.length > 0 ? "Forecast Applied" : "Generate AI Forecast"}
            </button>
        )}
      </div>

      <div className="p-4 flex-1 min-h-[350px]">
        {renderChart()}
      </div>
    </div>
  );
};

// --- Main Dashboard ---

const Dashboard: React.FC<DashboardProps> = ({ dataset, analysis, onReset }) => {
  const [activeTab, setActiveTab] = useState<string>('overview'); 
  const [sheetViewMode, setSheetViewMode] = useState<'chart' | 'pivot' | 'data'>('chart');
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(false);
  
  const [question, setQuestion] = useState('');
  const [chatHistories, setChatHistories] = useState<Record<string, ChatMessage[]>>({});
  const [isAsking, setIsAsking] = useState(false);
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  const activeSheet = dataset.sheets.find(s => s.sheetName === activeTab);
  const activeHistory = chatHistories[activeTab] || [];

  const currentCharts = activeTab === 'overview' 
    ? analysis.charts 
    : analysis.charts.filter(c => c.sheetName === activeTab);

  const displayCharts = (currentCharts.length > 0 || activeTab === 'overview')
    ? currentCharts
    : activeSheet 
        ? [{
            id: 'default', title: `Overview: ${activeTab}`, description: 'Auto-generated metric view',
            chartType: ChartType.BAR, sheetName: activeTab, xAxisKey: activeSheet.columns[0].name,
            dataKeys: activeSheet.columns.filter(c => c.type === 'number').map(c => c.name).slice(0, 1),
            aggregation: 'sum' as AggregationType, colors: []
          }]
        : [];

  const handleAskQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || isAsking) return;

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: question, timestamp: new Date() };
    const tempBotId = (Date.now() + 1).toString();
    const initialBotMsg: ChatMessage = { id: tempBotId, role: 'assistant', content: '', timestamp: new Date() };

    setChatHistories(prev => ({ ...prev, [activeTab]: [...(prev[activeTab] || []), userMsg, initialBotMsg] }));
    setQuestion('');
    setIsAsking(true);

    try {
      const contextType = activeTab === 'overview' ? 'overview' : 'sheet';
      const contextData = activeTab === 'overview' ? dataset : activeSheet!;

      // Stream the response
      for await (const token of streamAskQuestion(contextData, contextType, userMsg.content)) {
          setChatHistories(prev => {
              const currentHistory = prev[activeTab] ? [...prev[activeTab]] : [];
              const lastMsgIndex = currentHistory.findIndex(m => m.id === tempBotId);
              if (lastMsgIndex !== -1) {
                  currentHistory[lastMsgIndex] = {
                      ...currentHistory[lastMsgIndex],
                      content: currentHistory[lastMsgIndex].content + token
                  };
              }
              return { ...prev, [activeTab]: currentHistory };
          });
      }
    } catch {
       // Error handling implicitly covered by generator yielding error message
    } finally {
      setIsAsking(false);
    }
  };

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatHistories[activeTab], isAsking]);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-900">
      
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed md:relative z-50 h-full bg-slate-900 text-slate-300 flex flex-col transition-all duration-300
        ${isSidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full md:translate-x-0 md:w-0 md:overflow-hidden'}
      `}>
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-800 whitespace-nowrap overflow-hidden shrink-0">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold mr-3 shadow-lg shadow-indigo-900/50">IF</div>
              <span className="text-white font-bold text-lg tracking-tight">InsightFlow</span>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-slate-400">
              <X size={20} />
            </button>
        </div>
        <div className="flex-1 overflow-y-auto py-6 px-3 space-y-6 min-w-[16rem]">
            <div>
                <h3 className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Dashboards</h3>
                <button onClick={() => setActiveTab('overview')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'overview' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800'}`}>
                    <LayoutDashboard size={18} /> Overview
                </button>
            </div>
            <div>
                <h3 className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Data Sheets</h3>
                <div className="space-y-1">
                    {dataset.sheets.map(sheet => (
                        <button key={sheet.sheetName} onClick={() => setActiveTab(sheet.sheetName)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === sheet.sheetName ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800'}`}>
                            <Table2 size={18} /> <span className="truncate">{sheet.sheetName}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Tools Section - Now explicitly added */}
            <div>
                <h3 className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Tools</h3>
                 <button onClick={() => { setIsChatOpen(true); if(window.innerWidth < 768) setIsSidebarOpen(false); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isChatOpen ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800'}`}>
                    <Bot size={18} /> AI Assistant
                </button>
            </div>

            <div className="pt-4 border-t border-slate-800">
                <button onClick={onReset} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
                    <Share2 size={18} /> Import New File
                </button>
            </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative transition-all duration-300">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-8 shrink-0 z-10">
            <div className="flex items-center gap-4">
               {/* Hamburger Button */}
               <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                 <Menu size={20} />
               </button>
               <h2 className="text-lg sm:text-xl font-bold text-slate-800 flex items-center gap-2">
                  {activeTab === 'overview' ? 'Executive Overview' : activeTab}
               </h2>
               {activeTab !== 'overview' && (
                 <div className="hidden sm:flex bg-slate-100 p-1 rounded-lg ml-4">
                    <button onClick={() => setSheetViewMode('chart')} className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${sheetViewMode === 'chart' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>Charts</button>
                    <button onClick={() => setSheetViewMode('pivot')} className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${sheetViewMode === 'pivot' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>Pivot Table</button>
                    <button onClick={() => setSheetViewMode('data')} className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${sheetViewMode === 'data' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>Data</button>
                 </div>
               )}
            </div>
            
            {/* Top Right Actions */}
            <div className="flex gap-2">
                <button 
                   onClick={() => setIsChatOpen(!isChatOpen)}
                   className={`flex items-center gap-2 px-3 py-2 rounded-lg font-medium transition-all shadow-sm
                      ${isChatOpen 
                         ? 'bg-slate-100 text-slate-600 border border-slate-200' 
                         : 'bg-indigo-600 text-white shadow-indigo-200 hover:bg-indigo-700 hover:shadow-md'
                      }`}
                >
                   <MessageSquare size={18} />
                   <span className="hidden sm:inline">AI Chat</span>
                </button>
            </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-slate-50/50">
            <div className="max-w-7xl mx-auto space-y-8 pb-10">
                {activeTab === 'overview' ? (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 rounded-2xl p-6 sm:p-8 text-white shadow-xl shadow-indigo-200">
                            <h3 className="text-2xl font-bold mb-4">Analysis Summary</h3>
                            <p className="text-indigo-100 text-lg leading-relaxed max-w-4xl">{analysis.summary}</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
                                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
                                    <div className="flex items-center gap-2 mb-2 text-indigo-200 font-semibold"><BrainCircuit size={18} /> AI Inferences</div>
                                    <ul className="list-disc list-inside space-y-1 text-sm text-white/90">
                                        {analysis.inferences.slice(0, 3).map((inf, i) => <li key={i}>{inf}</li>)}
                                    </ul>
                                </div>
                                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
                                    <div className="flex items-center gap-2 mb-2 text-indigo-200 font-semibold"><Layers size={18} /> Cross-Sheet Patterns</div>
                                    <ul className="list-disc list-inside space-y-1 text-sm text-white/90">
                                        {analysis.crossSheetInsights.slice(0, 3).map((inf, i) => <li key={i}>{inf}</li>)}
                                    </ul>
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                           {displayCharts.map((chartConfig, idx) => {
                               const targetSheet = dataset.sheets.find(s => s.sheetName === chartConfig.sheetName);
                               if (!targetSheet) return null;
                               return <InteractiveChart key={chartConfig.id || idx} initialConfig={chartConfig} sheet={targetSheet} />;
                           })}
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex flex-col">
                        {/* Sheet Specific Views */}
                        {sheetViewMode === 'chart' && (
                             <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                {displayCharts.map((chartConfig, idx) => {
                                     const targetSheet = dataset.sheets.find(s => s.sheetName === chartConfig.sheetName);
                                     if (!targetSheet) return null;
                                     return <InteractiveChart key={chartConfig.id || idx} initialConfig={chartConfig} sheet={targetSheet} />;
                                })}
                             </div>
                        )}
                        {sheetViewMode === 'pivot' && activeSheet && (
                             <div className="h-[600px]">
                                <PivotTableBuilder sheet={activeSheet} />
                             </div>
                        )}
                        {sheetViewMode === 'data' && activeSheet && (
                            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                                    <h3 className="font-bold text-slate-800">Raw Data</h3>
                                    <span className="text-xs text-slate-500">First 100 rows</span>
                                </div>
                                <div className="overflow-x-auto max-h-[600px]">
                                    <table className="min-w-full divide-y divide-slate-200">
                                        <thead className="bg-slate-50 sticky top-0">
                                            <tr>
                                                {activeSheet.columns.map(c => (
                                                    <th key={c.name} className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50">{c.name}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-slate-200">
                                            {activeSheet.rawData.slice(0, 100).map((row, i) => (
                                                <tr key={i} className="hover:bg-slate-50 transition-colors">
                                                    {activeSheet.columns.map(c => (
                                                        <td key={`${i}-${c.name}`} className="px-6 py-2 whitespace-nowrap text-sm text-slate-600">{String(row[c.name] ?? '-')}</td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>

        {/* Streaming Chat Drawer */}
        <div className={`w-96 border-l border-slate-200 bg-white flex flex-col fixed right-0 top-16 bottom-0 shadow-2xl transition-transform duration-300 z-30 ${isChatOpen ? 'translate-x-0' : 'translate-x-full'}`}>
             <div className="p-4 border-b border-slate-100 bg-indigo-50/50 flex items-center justify-between">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    <Bot className="text-indigo-600" />
                    {activeTab === 'overview' ? 'Assistant' : `Chat: ${activeTab}`}
                </h3>
                <button onClick={() => setIsChatOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                    <X size={18}/>
                </button>
             </div>
             <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/30">
                 {activeHistory.length === 0 && (
                     <div className="text-center text-slate-400 mt-10 px-4">
                         <p className="text-sm mb-2">Ask about trends or specific values.</p>
                     </div>
                 )}
                 {activeHistory.map(msg => (
                     <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                         <div className={`rounded-xl p-3 text-sm max-w-[85%] ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>
                             {msg.content}
                             {msg.role === 'assistant' && msg.content === '' && isAsking && <span className="animate-pulse">...</span>}
                         </div>
                     </div>
                 ))}
                 <div ref={chatEndRef} />
             </div>
             <div className="p-4 border-t border-slate-100 bg-white">
                 <form onSubmit={handleAskQuestion} className="relative">
                     <input 
                       className="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                       placeholder="Ask a question..."
                       value={question}
                       onChange={e => setQuestion(e.target.value)}
                     />
                     <button type="submit" disabled={!question.trim() || isAsking} className="absolute right-2 top-2 text-indigo-600 disabled:opacity-30"><Send size={18} /></button>
                 </form>
             </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;