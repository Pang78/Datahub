import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, 
  PieChart, Pie, Cell, AreaChart, Area, ScatterChart, Scatter, ComposedChart
} from 'recharts';
import { AnalysisResult, Dataset, ChartType, ChartConfiguration, ChatMessage, Sheet, AggregationType } from '../types';
import { getSmartColor } from '../utils/dataUtils';
import { askDatasetQuestion, askSheetQuestion, generateChartForecast } from '../services/geminiService';
import { 
  Download, Share2, Filter, Lightbulb, TrendingUp, FileText, Send, MessageSquare, Bot, User, Loader2,
  BarChart3, PieChart as PieChartIcon, LineChart as LineChartIcon, ScatterChart as ScatterChartIcon, AreaChart as AreaChartIcon,
  Wand2, Settings2, ChevronDown, Table2, LayoutDashboard, BrainCircuit, Layers, X
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

  // Memoize aggregated data and handle forecast merging
  const processedData = useMemo(() => {
    // 1. Aggregate
    const baseData = aggregateData(sheet.rawData, xAxis, yKey, aggregation, groupBy || undefined);
    
    // 2. Append forecast if exists, with special handling for visualization
    if (forecastData.length > 0) {
       const forecastKey = `${yKey}_forecast`;
       
       // Clone base data to avoid mutation issues and prepare for split lines
       const combined = baseData.map(item => ({
         ...item,
         [forecastKey]: null // Ensure forecast key is null for history
       }));

       // To connect the history line to the forecast line visually, 
       // the last history point must also be the first point of the forecast line (or overlapping).
       // We add the forecast value to the last history item.
       if (combined.length > 0) {
         const lastItem = combined[combined.length - 1];
         lastItem[forecastKey] = lastItem[yKey];
       }

       // Append forecast items
       forecastData.forEach(item => {
         combined.push({
           ...item,
           [yKey]: null, // History key is null
           [forecastKey]: item[yKey], // Value is in forecast key
           _isForecast: true
         });
       });

       return combined;
    }

    return baseData;
  }, [sheet.rawData, xAxis, yKey, aggregation, groupBy, forecastData]);

  // Filter columns
  const numberColumns = sheet.columns.filter(c => c.type === 'number');
  const catColumns = sheet.columns.filter(c => c.type === 'string' || c.type === 'date');

  const handleForecast = async () => {
    if (isForecasting) return;
    setIsForecasting(true);
    try {
      // Forecast on the aggregated data (base data only, filter out any previous forecast if we were to re-run)
      // We pass the raw aggregated data without the split keys for the AI context
      const baseForAI = aggregateData(sheet.rawData, xAxis, yKey, aggregation, groupBy || undefined);
      
      const predictedPoints = await generateChartForecast(baseForAI, xAxis, yKey);
      if (predictedPoints && predictedPoints.length > 0) {
        const tagged = predictedPoints.map(p => ({ ...p, _isForecast: true }));
        setForecastData(tagged);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsForecasting(false);
    }
  };

  const renderChart = () => {
    const data = processedData; 
    const colors = config.colors || [];
    const forecastKey = `${yKey}_forecast`;

    const CommonAxis = () => (
      <>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis 
          dataKey={xAxis} 
          tick={{ fontSize: 10, fill: '#64748b' }} 
          axisLine={{ stroke: '#cbd5e1' }}
          tickLine={false}
          tickFormatter={(val) => String(val).substring(0, 10)}
        />
        <YAxis 
          tick={{ fontSize: 10, fill: '#64748b' }} 
          axisLine={false} 
          tickLine={false}
          tickFormatter={(value) => value >= 1000 ? `${(value/1000).toFixed(1)}k` : value}
        />
        <RechartsTooltip 
          contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
          labelStyle={{ color: '#64748b', fontSize: '12px' }}
        />
        <Legend wrapperStyle={{ paddingTop: '10px' }}/>
      </>
    );

    // If grouping is active (Stacked Bar)
    if (chartType === ChartType.BAR && groupBy) {
       // Find all unique keys for the stack
       const stackKeys = Array.from(new Set(sheet.rawData.map(r => r[groupBy]))).slice(0, 10); // Limit stacks
       return (
         <ResponsiveContainer width="100%" height={350}>
           <BarChart data={data}>
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
            <ChartComponent data={data}>
              {chartType === ChartType.AREA && (
                <defs>
                  <linearGradient id={`grad-${yKey}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={getSmartColor(0)} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={getSmartColor(0)} stopOpacity={0}/>
                  </linearGradient>
                </defs>
              )}
              <CommonAxis />
              
              {/* Historical Data Line/Area */}
              <DataComponent 
                type="monotone" 
                dataKey={yKey} 
                stroke={getSmartColor(0)} 
                fill={chartType === ChartType.AREA ? `url(#grad-${yKey})` : undefined}
                strokeWidth={2}
                name={yKey}
                activeDot={{ r: 6 }}
              />

              {/* Forecast Data Line/Area (Dashed) */}
              {forecastData.length > 0 && (
                <DataComponent
                  type="monotone"
                  dataKey={forecastKey}
                  stroke={getSmartColor(0)}
                  strokeDasharray="5 5"
                  fill={chartType === ChartType.AREA ? `url(#grad-${yKey})` : undefined}
                  fillOpacity={0.1}
                  strokeWidth={2}
                  name="Forecast"
                  dot={{ r: 4, fill: "#fff", stroke: getSmartColor(0), strokeWidth: 2 }}
                />
              )}
            </ChartComponent>
          </ResponsiveContainer>
        );
      case ChartType.PIE:
        return (
          <ResponsiveContainer width="100%" height={350}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={2}
                dataKey={yKey}
                nameKey={xAxis}
              >
                {data.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={getSmartColor(index)} />
                ))}
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
            <BarChart data={data}>
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
                <button 
                  key={t}
                  onClick={() => setChartType(t)}
                  className={`p-1.5 rounded-md ${chartType === t ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  {t === ChartType.BAR && <BarChart3 size={16} />}
                  {t === ChartType.LINE && <LineChartIcon size={16} />}
                  {t === ChartType.AREA && <AreaChartIcon size={16} />}
                  {t === ChartType.PIE && <PieChartIcon size={16} />}
                </button>
              ))}
           </div>
        </div>

        {/* Controls Toolbar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {/* X-Axis */}
            <div className="relative">
                <select 
                  className="w-full text-xs pl-2 pr-6 py-1.5 bg-white border border-slate-200 rounded-md appearance-none focus:border-indigo-500 outline-none"
                  value={xAxis}
                  onChange={e => setXAxis(e.target.value)}
                >
                   {sheet.columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                <div className="absolute right-2 top-2 pointer-events-none text-slate-400"><Settings2 size={12}/></div>
                <label className="absolute -top-2 left-2 bg-white px-1 text-[10px] text-slate-400">X-Axis</label>
            </div>

            {/* Y-Axis */}
            <div className="relative">
                <select 
                  className="w-full text-xs pl-2 pr-6 py-1.5 bg-white border border-slate-200 rounded-md appearance-none focus:border-indigo-500 outline-none"
                  value={yKey}
                  onChange={e => setYKey(e.target.value)}
                >
                   {numberColumns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                <div className="absolute right-2 top-2 pointer-events-none text-slate-400"><Settings2 size={12}/></div>
                <label className="absolute -top-2 left-2 bg-white px-1 text-[10px] text-slate-400">Y-Axis</label>
            </div>

            {/* Aggregation */}
            <div className="relative">
                <select 
                  className="w-full text-xs pl-2 pr-6 py-1.5 bg-white border border-slate-200 rounded-md appearance-none focus:border-indigo-500 outline-none uppercase"
                  value={aggregation}
                  onChange={e => setAggregation(e.target.value as AggregationType)}
                >
                   <option value="sum">Sum</option>
                   <option value="avg">Average</option>
                   <option value="max">Max</option>
                   <option value="min">Min</option>
                   <option value="count">Count</option>
                </select>
                <div className="absolute right-2 top-2 pointer-events-none text-slate-400"><ChevronDown size={12}/></div>
                <label className="absolute -top-2 left-2 bg-white px-1 text-[10px] text-slate-400">Aggr</label>
            </div>

            {/* Breakdown (Optional) */}
            <div className="relative">
                <select 
                  className="w-full text-xs pl-2 pr-6 py-1.5 bg-white border border-slate-200 rounded-md appearance-none focus:border-indigo-500 outline-none"
                  value={groupBy}
                  onChange={e => setGroupBy(e.target.value)}
                >
                   <option value="">None</option>
                   {catColumns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                <div className="absolute right-2 top-2 pointer-events-none text-slate-400"><Layers size={12}/></div>
                <label className="absolute -top-2 left-2 bg-white px-1 text-[10px] text-slate-400">Stack By</label>
            </div>
        </div>

        {/* Forecast Trigger */}
        {(chartType === ChartType.LINE || chartType === ChartType.AREA) && (
            <button 
                onClick={handleForecast}
                disabled={isForecasting || forecastData.length > 0 || !!groupBy}
                className="mt-3 w-full flex items-center justify-center gap-2 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors disabled:opacity-50"
            >
                {isForecasting ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                {forecastData.length > 0 ? "Forecast Applied" : "Generate AI Forecast"}
                {!!groupBy && <span className="text-[10px] opacity-70 ml-1">(N/A with Stack)</span>}
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
  const [activeTab, setActiveTab] = useState<string>('overview'); // 'overview' or sheetName
  const [question, setQuestion] = useState('');
  // Use a map to store chat history per sheet (or overview)
  const [chatHistories, setChatHistories] = useState<Record<string, ChatMessage[]>>({});
  const [isAsking, setIsAsking] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const activeSheet = dataset.sheets.find(s => s.sheetName === activeTab);
  const activeHistory = chatHistories[activeTab] || [];

  // Filter charts for current view
  const currentCharts = activeTab === 'overview' 
    ? analysis.charts 
    : analysis.charts.filter(c => c.sheetName === activeTab);

  // Fallback if no specific charts for a sheet
  const displayCharts = (currentCharts.length > 0 || activeTab === 'overview')
    ? currentCharts
    : activeSheet 
        ? [{
            id: 'default',
            title: `Data Overview for ${activeTab}`,
            description: 'Automatic visualization of primary metrics',
            chartType: ChartType.BAR,
            sheetName: activeTab,
            xAxisKey: activeSheet.columns[0].name,
            dataKeys: activeSheet.columns.filter(c => c.type === 'number').map(c => c.name).slice(0, 1),
            aggregation: 'sum' as AggregationType,
            colors: []
          }]
        : [];

  const handleAskQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || isAsking) return;

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: question, timestamp: new Date() };
    
    // Optimistic update
    const updatedHistory = [...activeHistory, userMsg];
    setChatHistories(prev => ({ ...prev, [activeTab]: updatedHistory }));
    
    setQuestion('');
    setIsAsking(true);

    try {
      let answer = "";
      if (activeTab === 'overview') {
        answer = await askDatasetQuestion(dataset, userMsg.content);
      } else {
        const sheet = dataset.sheets.find(s => s.sheetName === activeTab);
        if (sheet) {
          answer = await askSheetQuestion(sheet, userMsg.content);
        } else {
          answer = "Error: Sheet context not found.";
        }
      }

      const botMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'assistant', content: answer, timestamp: new Date() };
      setChatHistories(prev => ({ ...prev, [activeTab]: [...updatedHistory, botMsg] }));
    } catch {
      setChatHistories(prev => ({ ...prev, [activeTab]: [...updatedHistory, { id: 'err', role: 'assistant', content: "Error fetching answer.", timestamp: new Date() }] }));
    } finally {
      setIsAsking(false);
    }
  };

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatHistories, isAsking, activeTab]);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-900">
      
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shrink-0 transition-all duration-300 hidden md:flex">
        <div className="h-16 flex items-center px-6 border-b border-slate-800">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold mr-3 shadow-lg shadow-indigo-900/50">IF</div>
            <span className="text-white font-bold text-lg tracking-tight">InsightFlow</span>
        </div>

        <div className="flex-1 overflow-y-auto py-6 px-3 space-y-6">
            <div>
                <h3 className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Dashboards</h3>
                <button 
                  onClick={() => setActiveTab('overview')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'overview' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800'}`}
                >
                    <LayoutDashboard size={18} />
                    Overview
                </button>
            </div>

            <div>
                <h3 className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Data Sheets</h3>
                <div className="space-y-1">
                    {dataset.sheets.map(sheet => (
                        <button
                            key={sheet.sheetName}
                            onClick={() => setActiveTab(sheet.sheetName)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === sheet.sheetName ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800'}`}
                        >
                            <Table2 size={18} />
                            <span className="truncate">{sheet.sheetName}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="pt-4 border-t border-slate-800">
                <button onClick={onReset} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
                    <Share2 size={18} />
                    Import New File
                </button>
            </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-8 shrink-0 z-10">
            <div className="flex items-center gap-4">
               {/* Mobile/Tablet Menu Button could go here if left sidebar needs toggle */}
               <h2 className="text-lg sm:text-xl font-bold text-slate-800 flex items-center gap-2">
                  {activeTab === 'overview' ? 'Executive Overview' : activeTab}
                  {activeTab !== 'overview' && <span className="hidden sm:inline-block text-sm font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{activeSheet?.rowCount} rows</span>}
               </h2>
            </div>
            
            <div className="flex gap-2">
                <button 
                  onClick={() => setIsChatOpen(!isChatOpen)}
                  className={`p-2 rounded-lg transition-colors xl:hidden ${isChatOpen ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'}`}
                  title="Toggle AI Assistant"
                >
                  <MessageSquare size={20} />
                </button>
                <button className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"><Download size={20} /></button>
            </div>
        </header>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8">
            <div className="max-w-7xl mx-auto space-y-8 pb-10">
                
                {/* 1. Insights Section (Overview Only) */}
                {activeTab === 'overview' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {/* Summary Card */}
                        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 rounded-2xl p-6 sm:p-8 text-white shadow-xl shadow-indigo-200">
                            <h3 className="text-2xl font-bold mb-4">Analysis Summary</h3>
                            <p className="text-indigo-100 text-lg leading-relaxed max-w-4xl">{analysis.summary}</p>
                            
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
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
                    </div>
                )}

                {/* 2. Charts Grid */}
                <div>
                   <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                      <TrendingUp className="text-indigo-600" />
                      {activeTab === 'overview' ? 'Key Metrics Dashboard' : 'Sheet Visualization'}
                   </h3>
                   {displayCharts.length === 0 ? (
                       <div className="h-64 flex items-center justify-center bg-slate-100 rounded-xl border border-dashed border-slate-300 text-slate-400">
                          No relevant charts found for this view. Try creating one!
                       </div>
                   ) : (
                       <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                           {displayCharts.map((chartConfig, idx) => {
                               // Find the sheet this chart belongs to
                               const targetSheet = dataset.sheets.find(s => s.sheetName === chartConfig.sheetName);
                               if (!targetSheet) return null;
                               return <InteractiveChart key={chartConfig.id || idx} initialConfig={chartConfig} sheet={targetSheet} />;
                           })}
                       </div>
                   )}
                </div>

                {/* 3. Data Preview (Sheet View Only) */}
                {activeSheet && (
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                            <h3 className="font-bold text-slate-800">Raw Data Preview</h3>
                            <span className="text-xs text-slate-500">First 50 rows</span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-slate-200">
                                <thead className="bg-slate-50">
                                    <tr>
                                        {activeSheet.columns.map(c => (
                                            <th key={c.name} className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{c.name}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-slate-200">
                                    {activeSheet.rawData.slice(0, 50).map((row, i) => (
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
        </div>

        {/* Chat / Q&A Floating Widget or Panel */}
        {/* Responsive Drawer: Hidden on small unless toggled, Always visible on XL */}
        <div className={`w-96 border-l border-slate-200 bg-white flex flex-col fixed right-0 top-16 bottom-0 shadow-2xl transition-transform duration-300 z-30 ${isChatOpen ? 'translate-x-0' : 'translate-x-full xl:translate-x-0'}`}>
             <div className="p-4 border-b border-slate-100 bg-indigo-50/50 flex items-center justify-between">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    <Bot className="text-indigo-600" />
                    {activeTab === 'overview' ? 'Assistant' : `Chat: ${activeTab}`}
                </h3>
                {/* Close button for mobile */}
                <button onClick={() => setIsChatOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 xl:hidden">
                    <X size={18}/>
                </button>
             </div>
             <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/30">
                 {activeHistory.length === 0 && (
                     <div className="text-center text-slate-400 mt-10 px-4">
                         <p className="text-sm mb-2">Ask me about trends, outliers, or specific values in {activeTab === 'overview' ? 'your workbook' : `the "${activeTab}" sheet`}.</p>
                         <p className="text-xs text-slate-300">"What is the total sales?"</p>
                     </div>
                 )}
                 {activeHistory.map(msg => (
                     <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                         <div className={`rounded-xl p-3 text-sm max-w-[85%] ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>
                             {msg.content}
                         </div>
                     </div>
                 ))}
                 {isAsking && <div className="flex gap-2"><div className="bg-white border border-slate-200 rounded-xl p-3"><Loader2 size={16} className="animate-spin text-indigo-600" /></div></div>}
                 <div ref={chatEndRef} />
             </div>
             <div className="p-4 border-t border-slate-100 bg-white">
                 <form onSubmit={handleAskQuestion} className="relative">
                     <input 
                       className="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                       placeholder={activeTab === 'overview' ? "Ask about the workbook..." : `Ask about ${activeTab}...`}
                       value={question}
                       onChange={e => setQuestion(e.target.value)}
                     />
                     <button type="submit" disabled={!question.trim()} className="absolute right-2 top-2 text-indigo-600 disabled:opacity-30"><Send size={18} /></button>
                 </form>
             </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;