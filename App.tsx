
import React, { useState, useCallback } from 'react';
import { UploadCloud, FileSpreadsheet, AlertCircle, Loader2 } from 'lucide-react';
import { parseFile } from './utils/dataUtils';
import { analyzeDatasetWithGemini } from './services/geminiService';
import { Dataset, AnalysisResult, ProcessingState } from './types';
import Dashboard from './components/Dashboard';

const App: React.FC = () => {
  const [processing, setProcessing] = useState<ProcessingState>({ status: 'idle' });
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset State
    setProcessing({ status: 'parsing', message: 'Reading workbook structure...' });
    setDataset(null);
    setAnalysis(null);

    try {
      // 1. Parse Data
      const data = await parseFile(file);
      setDataset(data);
      
      // 2. Analyze with Gemini
      setProcessing({ status: 'analyzing', message: 'Gemini is identifying cross-sheet patterns & generating insights...' });
      const analysisResult = await analyzeDatasetWithGemini(data);
      
      setAnalysis(analysisResult);
      setProcessing({ status: 'complete' });

    } catch (error: any) {
      console.error(error);
      setProcessing({ 
        status: 'error', 
        message: error.message || "An unexpected error occurred processing the file." 
      });
    }
  }, []);

  const handleReset = () => {
    setDataset(null);
    setAnalysis(null);
    setProcessing({ status: 'idle' });
  };

  // Render Dashboard if analysis is complete
  if (dataset && analysis && processing.status === 'complete') {
    return <Dashboard dataset={dataset} analysis={analysis} onReset={handleReset} />;
  }

  // Render Upload / Loading Screen
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 relative overflow-hidden text-slate-100">
      
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
         <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-indigo-600 blur-[120px] opacity-20"></div>
         <div className="absolute top-[40%] -right-[10%] w-[40%] h-[60%] rounded-full bg-violet-600 blur-[120px] opacity-20"></div>
      </div>

      <div className="max-w-xl w-full relative z-10">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white mb-6 shadow-2xl shadow-indigo-900/50">
            <FileSpreadsheet size={40} />
          </div>
          <h1 className="text-5xl font-extrabold tracking-tight mb-4 bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
            InsightFlow AI
          </h1>
          <p className="text-xl text-slate-400 font-light">
            The Super Data App. Upload complex workbooks, get instant intelligence.
          </p>
        </div>

        <div className="bg-slate-800/50 backdrop-blur-xl rounded-3xl shadow-2xl border border-slate-700/50 p-8 transition-all hover:border-indigo-500/30">
          
          {processing.status === 'idle' || processing.status === 'error' ? (
            <div className="space-y-6">
              <label 
                htmlFor="file-upload" 
                className="group flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-slate-600 rounded-2xl cursor-pointer bg-slate-800/50 hover:bg-slate-800 hover:border-indigo-500 transition-all"
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <div className="w-16 h-16 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center mb-4 group-hover:scale-110 group-hover:bg-indigo-500 group-hover:text-white transition-all duration-300">
                      <UploadCloud size={32} />
                  </div>
                  <p className="mb-2 text-lg text-slate-200 font-semibold">Click to upload or drag and drop</p>
                  <p className="text-sm text-slate-500">Excel (XLSX, XLS) or CSV • Multi-sheet supported</p>
                </div>
                <input 
                    id="file-upload" 
                    type="file" 
                    accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                    className="hidden" 
                    onChange={handleFileUpload}
                />
              </label>
              
              {processing.status === 'error' && (
                <div className="flex items-start gap-3 p-4 bg-red-900/20 border border-red-900/50 text-red-200 rounded-xl text-sm">
                   <AlertCircle size={20} className="shrink-0 mt-0.5 text-red-400" />
                   <p>{processing.message}</p>
                </div>
              )}
            </div>
          ) : (
             <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="relative mb-8">
                    <div className="w-20 h-20 border-4 border-indigo-900 border-t-indigo-500 rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 size={32} className="text-indigo-400" />
                    </div>
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">
                    {processing.status === 'parsing' ? 'Parsing Workbook...' : 'Synthesizing Insights...'}
                </h3>
                <p className="text-slate-400 max-w-xs mx-auto animate-pulse">
                    {processing.message}
                </p>
             </div>
          )}

        </div>

        <div className="mt-8 text-center flex items-center justify-center gap-2">
          <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
          <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold">Powered by Gemini 2.5 Flash</p>
        </div>
      </div>
    </div>
  );
};

export default App;
