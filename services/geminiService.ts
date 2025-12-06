import { GoogleGenAI, Type } from "@google/genai";
import { Dataset, AnalysisResult, ChartType, Sheet } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeDatasetWithGemini = async (dataset: Dataset): Promise<AnalysisResult> => {
  
  // Construct a summary of all sheets
  const datasetStructure = dataset.sheets.map(sheet => ({
    sheetName: sheet.sheetName,
    rowCount: sheet.rowCount,
    columns: sheet.columns.map(c => ({
      name: c.name,
      type: c.type,
      distinctCount: c.distinctCount,
      exampleValues: c.sampleValues.join(', '),
      range: c.type === 'number' ? `${c.min} to ${c.max}` : 'N/A'
    }))
  }));

  const prompt = `
    You are an expert Chief Data Officer and Data Scientist. 
    I have an Excel file named "${dataset.fileName}" containing ${dataset.sheets.length} sheets.
    
    Here is the schema and profile of the sheets:
    ${JSON.stringify(datasetStructure, null, 2)}
    
    Your goal is to perform a deep, synthesized analysis of this data.
    
    1. **Executive Summary**: Synthesize what this entire workbook represents (e.g., "A complete sales ledger with separate tables for Transactions and Customer demographics").
    2. **Cross-Sheet Insights**: Identify relationships between sheets. Does Sheet A look like a foreign key reference for Sheet B? Are there correlations?
    3. **Educated Inferences**: Make logical leaps based on the data profile. E.g., "High variance in the 'Amount' column suggests potential outliers or enterprise-level deals mixed with SMBs." or "The date range indicates Q4 data, suggesting seasonality effects."
    4. **Chart Recommendations**: Suggest 4-6 advanced visualizations.
       - Specify which 'sheetName' the chart draws from.
       - Suggest an 'aggregation' (sum, avg, count) for the metric.
       - If a categorical column has low cardinality (e.g., Region, Status), use it as 'groupByKey' for stacked charts.
    
    Output JSON format only.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING, description: "High-level executive summary of the workbook." },
            crossSheetInsights: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Insights connecting multiple sheets or structural observations."
            },
            inferences: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Deeper, educated guesses about the business logic or data quality."
            },
            charts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  chartType: { type: Type.STRING, enum: Object.values(ChartType) },
                  sheetName: { type: Type.STRING },
                  xAxisKey: { type: Type.STRING },
                  dataKeys: { type: Type.ARRAY, items: { type: Type.STRING } },
                  aggregation: { type: Type.STRING, enum: ['sum', 'avg', 'count', 'min', 'max'] },
                  groupByKey: { type: Type.STRING, nullable: true },
                  colors: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["id", "title", "chartType", "sheetName", "xAxisKey", "dataKeys", "aggregation"]
              }
            }
          },
          required: ["summary", "crossSheetInsights", "inferences", "charts"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    
    return JSON.parse(text) as AnalysisResult;

  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw new Error("Failed to generate insights. Please try again.");
  }
};

// --- Streaming Q&A ---

export const streamAskQuestion = async function* (
  contextData: any, 
  contextType: 'overview' | 'sheet',
  question: string
) {
  try {
    let promptContext = "";
    
    if (contextType === 'overview') {
      const dataset = contextData as Dataset;
      const samples = dataset.sheets.map(s => ({
        sheet: s.sheetName,
        sample: s.rawData.slice(0, 30) 
      }));
      promptContext = `
        Context: Full Workbook Overview.
        Sheets & Samples: ${JSON.stringify(samples)}
      `;
    } else {
      const sheet = contextData as Sheet;
      promptContext = `
        Context: Specific Sheet "${sheet.sheetName}".
        Schema: ${JSON.stringify(sheet.columns)}
        Sample Data (first 100 rows): ${JSON.stringify(sheet.rawData.slice(0, 100))}
      `;
    }

    const prompt = `
      You are a specialized data analyst.
      ${promptContext}
      
      User Question: ${question}

      Instructions:
      1. Answer concisely.
      2. If calculating, state "Based on the provided sample...".
      3. Use markdown for tables or lists if needed.
    `;

    const responseStream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    for await (const chunk of responseStream) {
      if (chunk.text) {
        yield chunk.text;
      }
    }

  } catch (error) {
    console.error("Gemini Stream Error:", error);
    yield "Sorry, I encountered an error analyzing the data.";
  }
};

export const generateChartForecast = async (data: any[], xAxisKey: string, yAxisKey: string): Promise<any[]> => {
  try {
    const recentData = data.slice(-30);
    
    const prompt = `
      You are a statistical forecasting expert. 
      X-Axis: ${xAxisKey}
      Y-Axis: ${yAxisKey}
      
      Data: ${JSON.stringify(recentData)}

      Predict the next 5 points.
      Return JSON array of objects with "${xAxisKey}" and "${yAxisKey}".
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              [xAxisKey]: { type: Type.STRING },
              [yAxisKey]: { type: Type.NUMBER }
            }
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    return JSON.parse(text);
  } catch (error) {
    return [];
  }
};
