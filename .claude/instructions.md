{
  "app_name": "DJ Engine",
  "navigation_type": "stack",
  "theme_colors": {
    "primary": "#1DB954",
    "secondary": "#191414"
  },
  "pages": [
    {
      "id": "home",
      "component_name": "HomePage",
      "title": "Start",
      "description": "Main landing page with scan music button, open SD card, and start analysis actions. Includes email/password login and sign-up via Supabase auth, shows logged-in user email with sign-out option.",
      "type": "core"
    },
    {
      "id": "folder_browser",
      "component_name": "FolderBrowserPage",
      "title": "Ordner",
      "description": "Reads selected SD-card path from AsyncStorage, scans Engine Library/Music or root for real folders, counts music files per folder, enriches analysed-count from Engine DJ m.db, long-press menu: create playlist or add to existing playlist in local SQLite with real BPM and Camelot key data from Engine DJ database, 'Ordner analysieren' navigates to AnalysisProgress",
      "type": "core"
    },
    {
      "id": "playlist_manager",
      "component_name": "PlaylistManagerPage",
      "title": "Playlists",
      "description": "Create, edit, delete playlists stored in local SQLite database; sync to Denon SC Live 4 in Engine DJ format with Camelot key and BPM data",
      "type": "core"
    },
    {
      "id": "analysis_progress",
      "component_name": "AnalysisProgressPage",
      "title": "Analyse",
      "description": "Reads BPM, Camelot key, beatgrid analysis data from Engine DJ SQLite database (m.db) on SD card, shows track list with animated progress indicator and per-track BPM/key badges",
      "type": "core"
    },
    {
      "id": "sd_card_selector",
      "component_name": "SDCardSelectorPage",
      "title": "SD-Karte auswählen",
      "description": "Scan and select storage volumes, detect Engine DJ Database2/m.db structure, persist selected SD card path via AsyncStorage, manual folder picker fallback",
      "type": "core"
    },
    {
      "id": "sync_settings",
      "component_name": "SyncSettingsPage",
      "title": "Synchronisierung",
      "description": "Engine DJ Database2/m.db sync settings with toggles for playlists, analysis data, waveforms, crates. Collapsible folder browser reads playlists and track lists from m.db. Shows step-by-step sync progress, format compatibility info (SQLite/Camelot/SC Live 4), and SD card status.",
      "type": "core"
    }
  ]
}