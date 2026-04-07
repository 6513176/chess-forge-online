import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load .env variables if available
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = 'chess-forge';

async function exportToCSV() {
  console.log(`Connecting to MongoDB at: ${mongoUri.replace(/:([^:@]{3,})@/, ':***@')}`);
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection('match_summaries');

    // Fetch all summaries
    const summaries = await collection.find({}).toArray();
    console.log(`Found ${summaries.length} match summaries.`);

    if (summaries.length === 0) {
      console.log('No data to export.');
      return;
    }

    // Determine all possible keys across all documents to create CSV headers
    const allKeys = new Set();

    // Explicitly add our demographic fields first for better readability
    const priorityKeys = [
      'createdAt', 'userId', 'firstName', 'lastName', 'age', 'boardGameExp', 'chessExp',
      'outcome', 'reason', 'mySide', 'timeLeftSeconds', 'cardsPlayedCount'
    ];

    priorityKeys.forEach(k => allKeys.add(k));

    summaries.forEach(doc => {
      Object.keys(doc).forEach(key => {
        if (key !== '_id' && key !== 'cardsPlayedList') {
          allKeys.add(key);
        }
      });
    });

    const headers = Array.from(allKeys);

    // Create CSV rows
    const csvRows = [];
    csvRows.push(headers.join(',')); // Add header row

    summaries.forEach(doc => {
      const row = headers.map(header => {
        let val = doc[header];
        if (val === null || val === undefined) return '';

        // Escape quotes and handle commas
        if (typeof val === 'string') {
          val = val.replace(/"/g, '""');
          if (val.includes(',') || val.includes('"') || val.includes('\n')) {
            val = `"${val}"`;
          }
        }
        return val;
      });
      csvRows.push(row.join(','));
    });

    const csvContent = csvRows.join('\n');
    const outputPath = path.join(__dirname, '..', 'survey_results.csv');

    fs.writeFileSync(outputPath, csvContent, 'utf-8');
    console.log(`\n✅ Export successful!`);
    console.log(`📁 File saved at: ${outputPath}`);
    console.log(`\nYou can now open this file in Excel, SPSS, or Google Sheets.`);

  } catch (error) {
    console.error('Error exporting data:', error);
  } finally {
    await client.close();
  }
}

exportToCSV();
