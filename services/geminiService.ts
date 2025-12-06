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

export const askDatasetQuestion = async (dataset: Dataset, question: string): Promise<string> => {
  try {
    // Send samples from ALL sheets to give context
    const context = dataset.sheets.map(s => ({
      sheet: s.sheetName,
      sample: s.rawData.slice(0, 50) // Reduce sample size per sheet to fit context
    }));

    const prompt = `
      You are a helpful data assistant. I have a workbook named "${dataset.fileName}".
      
      Here are data samples from the sheets:
      ${JSON.stringify(context)}

      Question: ${question}

      Instructions:
      1. Analyze the samples provided.
      2. If the user asks for aggregations (total, average), calculate them based on the sample provided and explicitly state "Based on the sample data provided...".
      3. If the answer requires joining sheets, explain the logic.
      4. Be concise and professional.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    return response.text || "I couldn't generate an answer.";
  } catch (error) {
    console.error("Gemini Q&A Error:", error);
    throw new Error("Failed to get an answer.");
  }
};

export const askSheetQuestion = async (sheet: Sheet, question: string): Promise<string> => {
  try {
    const context = {
      sheetName: sheet.sheetName,
      columns: sheet.columns,
      sampleData: sheet.rawData.slice(0, 100) // Slightly larger sample for single-sheet focus
    };

    const prompt = `
      You are a specialized data analyst focusing on the "${sheet.sheetName}" sheet.
      
      Here is the schema and a sample of 100 rows:
      ${JSON.stringify(context)}

      User Question: ${question}

      Instructions:
      1. Provide a direct answer based on the sample data.
      2. If the question involves data outside the sample, explain how you would calculate it if you had full access, or give the answer based on the visible rows.
      3. Detect trends or anomalies if relevant to the question.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    return response.text || "I couldn't generate an answer for this sheet.";
  } catch (error) {
    console.error("Gemini Sheet Q&A Error:", error);
    throw new Error("Failed to get an answer.");
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