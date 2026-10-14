import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Sends each run-log row to the developer's Google Sheet (Oct 14), so runs on
// testers' phones can be evaluated without asking anyone for a CSV.
//
// The Sheet's web-app URL is injected at build time (GitHub secret ASSAY_LOG_URL
// -> app.json extra.logUrl) and is not in the public repo. No URL (local or
// debug builds without it) means nothing is sent. The user can turn sharing
// off in Settings. Never sent: the Groq key or anything about the person.

const QUEUE_KEY = '@tfc_remote_log_queue';
const OPT_KEY = '@tfc_share_logs';
const DEVICE_KEY = '@tfc_device_id';
const MAX_QUEUED = 30; // a phone offline for days should not grow without bound

const logUrl = () => Constants.expoConfig?.extra?.logUrl || '';

export const getShareLogs = async () => (await AsyncStorage.getItem(OPT_KEY).catch(() => null)) !== 'off';
export const setShareLogs = async (on) => {
  await AsyncStorage.setItem(OPT_KEY, on ? 'on' : 'off');
  if (!on) await AsyncStorage.removeItem(QUEUE_KEY);
};

// A random id per install, so one tester's runs can be told apart. Not tied
// to the phone or the person.
const deviceId = async () => {
  let id = await AsyncStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    await AsyncStorage.setItem(DEVICE_KEY, id);
  }
  return id;
};

let flushing = false;
const flush = async () => {
  if (flushing || !logUrl()) return;
  flushing = true;
  try {
    let queue = JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) || '[]');
    while (queue.length) {
      // text/plain: Apps Script reads the body as-is and no CORS preflight runs.
      const res = await fetch(logUrl(), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(queue[0]) });
      if (!res.ok) break; // keep it for the next run
      queue = queue.slice(1);
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    }
  } catch (e) {
    // Offline or the Sheet is busy: the rows wait in the queue.
  } finally {
    flushing = false;
  }
};

// columns: the CSV header order; fields: one run, as written to the CSV.
export const sendRunRow = async (columns, fields) => {
  try {
    if (!logUrl() || !(await getShareLogs())) return;
    const row = {
      device: await deviceId(),
      appVersion: Constants.expoConfig?.version || '',
      android: String(Platform.Version),
    };
    for (const c of columns) row[c] = fields[c] === null || fields[c] === undefined ? '' : String(fields[c]);
    const queue = JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) || '[]');
    queue.push(row);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUED)));
    flush();
  } catch (e) {
    console.warn('Could not queue log row: ' + e.message);
  }
};
