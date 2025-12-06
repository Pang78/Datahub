
import { DataColumnProfile, Dataset, Sheet } from '../types';

// Declare XLSX globally as it is loaded via CDN in index.html
declare const XLSX: any;

export const parseFile = async (file: File): Promise<Dataset> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        
        const sheets: Sheet[] = [];
        let totalRows = 0;

        // Iterate through all sheets
        workbook.SheetNames.forEach((sheetName: string) => {
          const sheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: null });
          
          // Skip empty sheets
          if (jsonData && jsonData.length > 0) {
            const columns = profileColumns(jsonData);
            sheets.push({
              sheetName: sheetName,
              rawData: jsonData,
              columns: columns,
              rowCount: jsonData.length
            });
            totalRows += jsonData.length;
          }
        });
        
        if (sheets.length === 0) {
          throw new Error("No data found in the file.");
        }

        resolve({
          fileName: file.name,
          sheets: sheets,
          totalRows: totalRows
        });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = (error) => reject(error);

    // Read as binary string for XLSX support
    reader.readAsBinaryString(file);
  });
};

const profileColumns = (data: any[]): DataColumnProfile[] => {
  if (data.length === 0) return [];
  
  const keys = Object.keys(data[0]);
  
  return keys.map(key => {
    const values = data.map(row => row[key]).filter(v => v !== null && v !== undefined);
    const distinctValues = new Set(values);
    
    // Type detection
    let type: 'string' | 'number' | 'date' | 'boolean' = 'string';
    const sample = values[0];
    
    if (typeof sample === 'number') type = 'number';
    else if (typeof sample === 'boolean') type = 'boolean';
    else if (sample instanceof Date || (typeof sample === 'string' && !isNaN(Date.parse(sample)) && sample.length > 5 && (sample.includes('-') || sample.includes('/')))) {
        // Prioritize number if it looks like a clean number, even if Date.parse accepts it
        if(typeof sample === 'number') type = 'number';
        else type = 'date';
    }

    let min: number | undefined;
    let max: number | undefined;

    if (type === 'number') {
      const numValues = values as number[];
      min = Math.min(...numValues);
      max = Math.max(...numValues);
    }

    return {
      name: key,
      type,
      sampleValues: Array.from(distinctValues).slice(0, 5),
      distinctCount: distinctValues.size,
      min,
      max
    };
  });
};

export const getSmartColor = (index: number): string => {
  const palette = [
    '#6366f1', // indigo-500
    '#10b981', // emerald-500
    '#f59e0b', // amber-500
    '#ec4899', // pink-500
    '#3b82f6', // blue-500
    '#8b5cf6', // violet-500
    '#f43f5e', // rose-500
    '#06b6d4', // cyan-500
    '#84cc16'  // lime-500
  ];
  return palette[index % palette.length];
};
