/**
 * Song Storage - Shared access to songs stored in IndexedDB
 * 
 * Use this in sketches to load songs that were imported in the signal editor.
 * The signal editor stores full song data including audio in IndexedDB,
 * which can then be accessed from any page on the same origin.
 */

const DB_NAME = 'AudioTracksDB';
const DB_VERSION = 2;
const SONGS_STORE = 'songs';

let db = null;

/**
 * Initialize the database connection
 */
async function initDB() {
  if (db) return db;
  
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { 
      db = request.result; 
      resolve(db); 
    };
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(SONGS_STORE)) {
        database.createObjectStore(SONGS_STORE, { keyPath: 'id' });
      }
    };
  });
}

/**
 * Get list of all available songs (metadata only, no audio data)
 * @returns {Promise<Array>} Array of song metadata objects
 */
export async function getSongList() {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction([SONGS_STORE], 'readonly');
    const req = tx.objectStore(SONGS_STORE).getAll();
    req.onsuccess = () => {
      // Return metadata only (exclude large audioData)
      const songs = (req.result || []).map(s => ({
        id: s.id,
        name: s.name,
        fileName: s.fileName,
        duration: s.duration,
        bpm: s.bpm,
        hasAudio: !!s.audioData
      }));
      resolve(songs);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Load a complete song by ID (including audio data)
 * @param {string} id - Song ID
 * @returns {Promise<Object|null>} Full song object or null if not found
 */
export async function loadSong(id) {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction([SONGS_STORE], 'readonly');
    const req = tx.objectStore(SONGS_STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Load a song and create an audio URL for playback
 * @param {string} id - Song ID
 * @returns {Promise<{song: Object, audioUrl: string|null}>} Song data and blob URL for audio
 */
export async function loadSongWithAudio(id) {
  const song = await loadSong(id);
  if (!song) return { song: null, audioUrl: null };
  
  let audioUrl = null;
  if (song.audioData?.byteLength > 0) {
    const blob = new Blob([song.audioData], { type: 'audio/mpeg' });
    audioUrl = URL.createObjectURL(blob);
  }
  
  return { song, audioUrl };
}

/**
 * Check if any songs are available
 * @returns {Promise<boolean>}
 */
export async function hasSongs() {
  const songs = await getSongList();
  return songs.length > 0;
}
