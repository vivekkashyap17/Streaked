import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { createAudioPlayer, AudioPlayer } from 'expo-audio';
import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';

// Show reminders as a banner (and play a sound) even when the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// A single goal. Name plus an optional daily reminder.
type Goal = {
  id: string;
  name: string;
  // These three are set together when a reminder is on, and cleared together
  // when it's off. notificationId is what we use to cancel the reminder.
  reminderHour?: number; // 0-23
  reminderMinute?: number; // 0-59
  reminderSound?: string; // which alarm sound: a key from REMINDER_SOUNDS
  notificationId?: string;
};

// A daily log: whether one goal was done on one day.
// There is at most one log per goal per day.
// Past logs are never changed or deleted.
type DailyLog = {
  goalId: string;
  date: string; // YYYY-MM-DD
  done: boolean;
};

// Goals and logs are two separate stores on the device.
const GOALS_KEY = 'goals';
const LOGS_KEY = 'logs';
// The saved theme choice.
const THEME_KEY = 'themePref';
// The saved sort choice.
const SORT_KEY = 'sortMode';

// Streak lengths (in days) worth celebrating. Add more here anytime.
const MILESTONES = [7, 30, 100];

// Which theme the user picked. 'system' follows the phone's light/dark setting.
type ThemePref = 'light' | 'dark' | 'system';

// How to order the goals list. 'manual' = the user's own ↑/↓ order.
type SortMode = 'manual' | 'streak' | 'todo' | 'name';

// The theme choices shown on the Settings screen.
const THEME_OPTIONS: { key: ThemePref; label: string }[] = [
  { key: 'system', label: '⚙️ System' },
  { key: 'light', label: '☀️ Light' },
  { key: 'dark', label: '🌙 Dark' },
];

// Used to build friendly day labels without relying on Intl
// (React Native's engine has limited Intl support).
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// The alarm sounds the user can pick from. Each sound gets its own Android
// notification channel, because a channel's sound is fixed once it is created.
// `file` must match a file in assets/sounds AND the list in app.json's
// expo-notifications plugin.
const REMINDER_SOUNDS = [
  {
    key: 'vibration',
    label: 'Vibration',
    file: 'vibration.wav',
    channelId: 'reminders-vibration',
    preview: require('./assets/sounds/vibration.wav'),
  },
  {
    key: 'effect',
    label: 'Sound effect',
    file: 'vibration_sound_effect.wav',
    channelId: 'reminders-effect',
    preview: require('./assets/sounds/vibration_sound_effect.wav'),
  },
  {
    key: 'aot',
    label: 'Attack on Titan',
    file: 'attack_on_titan.wav',
    channelId: 'reminders-aot',
    preview: require('./assets/sounds/attack_on_titan.wav'),
  },
  {
    key: 'cityzen',
    label: 'City Zen',
    file: 'city_zen_music.wav',
    channelId: 'reminders-cityzen',
    preview: require('./assets/sounds/city_zen_music.wav'),
  },
  {
    key: 'eren',
    label: 'Eren Titan',
    file: 'eren_titan.wav',
    channelId: 'reminders-eren',
    preview: require('./assets/sounds/eren_titan.wav'),
  },
  {
    key: 'naruto',
    label: 'Naruto Flute',
    file: 'naruto_flute_ringtone.wav',
    channelId: 'reminders-naruto',
    preview: require('./assets/sounds/naruto_flute_ringtone.wav'),
  },
  {
    key: 'solo',
    label: 'Solo Leveling',
    file: 'solo_leveling_metal.wav',
    channelId: 'reminders-solo',
    preview: require('./assets/sounds/solo_leveling_metal.wav'),
  },
];

// Look up a sound by its key (falls back to the first sound).
function soundByKey(key?: string) {
  return REMINDER_SOUNDS.find((s) => s.key === key) ?? REMINDER_SOUNDS[0];
}

// Format a Date as YYYY-MM-DD, using the phone's local time.
function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// The app's colour palette. Every colour in the UI comes from here, so light
// and dark mode are just two versions of the same named tokens. The active one
// is chosen from the phone's system setting (see useColorScheme in App).
type Theme = {
  bg: string; // screen background
  surface: string; // cards and rows
  surfaceAlt: string; // subtle button background
  border: string; // hairlines and card borders
  inputBg: string; // text-input background
  text: string; // primary text
  muted: string; // secondary text
  faint: string; // the faintest text / outlines
  accent: string; // brand green (buttons, done)
  onAccent: string; // text on an accent background
  danger: string; // delete
  onDanger: string;
  neutral: string; // the Edit button
  onNeutral: string;
  heatMiss: string; // a not-done day in the heatmap
  todayOutline: string; // outline around today's cell
};

const lightTheme: Theme = {
  bg: '#f6f8f6',
  surface: '#ffffff',
  surfaceAlt: '#eef2ee',
  border: '#dde3de',
  inputBg: '#ffffff',
  text: '#17201b',
  muted: '#5c675f',
  faint: '#9aa39c',
  accent: '#0e7a4f',
  onAccent: '#ffffff',
  danger: '#c0392b',
  onDanger: '#ffffff',
  neutral: '#4a6572',
  onNeutral: '#ffffff',
  heatMiss: '#e4e8e4',
  todayOutline: '#f39c12',
};

const darkTheme: Theme = {
  bg: '#0e1210',
  surface: '#181f1b',
  surfaceAlt: '#232b26',
  border: '#2c342e',
  inputBg: '#141a16',
  text: '#e8ede9',
  muted: '#9aa8a0',
  faint: '#6b766e',
  accent: '#1f9d63',
  onAccent: '#ffffff',
  danger: '#d9534f',
  onDanger: '#ffffff',
  neutral: '#5b7683',
  onNeutral: '#ffffff',
  heatMiss: '#28312b',
  todayOutline: '#f0a53a',
};

// Turn a "YYYY-MM-DD" string back into a local Date (midnight, local time).
// Building it from parts avoids the timezone shift you get from new Date(str).
function parseDate(s: string): Date {
  const [year, month, day] = s.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// A readable label like "Mon, Jul 7".
function dayLabel(d: Date): string {
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// A friendly time like "8:30 AM".
function formatTime(hour: number, minute: number): string {
  const ampm = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const mm = String(minute).padStart(2, '0');
  return `${h12}:${mm} ${ampm}`;
}

// Today's date as YYYY-MM-DD.
function todayString(): string {
  return formatDate(new Date());
}

// The current streak for a goal, computed from a given list of logs: how many
// days in a row up to today the goal is done. Pulled out as a plain function so
// it can be run against a just-updated log list (React state isn't immediate).
function streakFromLogs(logsList: DailyLog[], goalId: string): number {
  const doneDates = new Set(
    logsList.filter((l) => l.goalId === goalId && l.done).map((l) => l.date),
  );
  let streak = 0;
  const cursor = new Date(); // start at today and walk backwards
  while (doneDates.has(formatDate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export default function App() {
  // The text currently typed in the input box.
  const [text, setText] = useState('');
  // The list of goals.
  const [goals, setGoals] = useState<Goal[]>([]);
  // Every daily log we have saved.
  const [logs, setLogs] = useState<DailyLog[]>([]);
  // Which screen is showing.
  const [screen, setScreen] = useState<
    'goals' | 'history' | 'calendar' | 'settings'
  >('goals');
  // Which goal the calendar screen is showing (null = none chosen).
  const [calendarGoalId, setCalendarGoalId] = useState<string | null>(null);
  // Lets the calendar auto-scroll to the newest week on open.
  const calendarScrollRef = useRef<ScrollView>(null);
  // The goal we're currently picking a reminder time for (null = picker hidden).
  const [pickingGoalId, setPickingGoalId] = useState<string | null>(null);
  // When set, the sound-picker modal is open for this goal + chosen time.
  const [soundPickerFor, setSoundPickerFor] = useState<{
    goalId: string;
    hour: number;
    minute: number;
  } | null>(null);
  // The audio player used to preview a sound (and a timer to stop it).
  const previewPlayerRef = useRef<AudioPlayer | null>(null);
  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The goal we're currently renaming (null = not editing), and its edited text.
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  // The chosen theme: 'system' (follow the phone), or a forced 'light' / 'dark'.
  const [themePref, setThemePref] = useState<ThemePref>('system');
  // How the goals list is ordered (defaults to the user's manual order).
  const [sortMode, setSortMode] = useState<SortMode>('manual');

  // Work out which theme to use, then build the styles for it. When the choice
  // is 'system' we follow the phone's setting; otherwise we force one.
  const systemScheme = useColorScheme();
  const activeScheme = themePref === 'system' ? systemScheme : themePref;
  const theme = activeScheme === 'dark' ? darkTheme : lightTheme;
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // A short label for the sort button.
  const sortLabel =
    sortMode === 'streak'
      ? 'Streak'
      : sortMode === 'todo'
      ? 'To-do first'
      : sortMode === 'name'
      ? 'Name'
      : 'Manual';

  const today = todayString();

  // Load the saved goals and logs once, when the app starts.
  useEffect(() => {
    AsyncStorage.getItem(GOALS_KEY).then((stored) => {
      if (stored !== null) setGoals(JSON.parse(stored));
    });
    AsyncStorage.getItem(LOGS_KEY).then((stored) => {
      if (stored !== null) setLogs(JSON.parse(stored));
    });
    AsyncStorage.getItem(THEME_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setThemePref(stored);
      }
    });
    AsyncStorage.getItem(SORT_KEY).then((stored) => {
      if (
        stored === 'manual' ||
        stored === 'streak' ||
        stored === 'todo' ||
        stored === 'name'
      ) {
        setSortMode(stored);
      }
    });
  }, []);

  // Create one Android notification channel per alarm sound (needed on Android;
  // harmless on other platforms). Each channel is high-importance and vibrates,
  // so a reminder feels like an alarm. A channel's sound can't be changed after
  // it is created, which is why every sound gets its own channel.
  useEffect(() => {
    REMINDER_SOUNDS.forEach((s) => {
      Notifications.setNotificationChannelAsync(s.channelId, {
        name: `Reminders (${s.label})`,
        importance: Notifications.AndroidImportance.MAX,
        sound: s.file,
        vibrationPattern: [0, 250, 250, 250],
        enableVibrate: true,
      });
    });
  }, []);

  // --- Goals: save, add, delete ---

  const saveGoals = async (newGoals: Goal[]) => {
    setGoals(newGoals);
    await AsyncStorage.setItem(GOALS_KEY, JSON.stringify(newGoals));
  };

  const addGoal = () => {
    const name = text.trim();
    if (name === '') return; // ignore empty input
    const newGoal: Goal = { id: Date.now().toString(), name };
    saveGoals([...goals, newGoal]);
    setText(''); // clear the input box
  };

  const deleteGoal = (id: string) => {
    // Remove the goal, but keep its logs — history is never deleted.
    saveGoals(goals.filter((goal) => goal.id !== id));
  };

  // Open the calendar/heatmap screen for one goal.
  const openCalendar = (goalId: string) => {
    setCalendarGoalId(goalId);
    setScreen('calendar');
  };

  // Move a goal up (-1) or down (+1) in the list by swapping it with its
  // neighbour. Reordering only changes the goals' order, not their logs.
  const moveGoal = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= goals.length) return; // already at the edge
    const newGoals = [...goals];
    [newGoals[index], newGoals[target]] = [newGoals[target], newGoals[index]];
    saveGoals(newGoals);
  };

  // Set the theme choice (from the Settings screen) and remember it.
  const chooseTheme = (pref: ThemePref) => {
    setThemePref(pref);
    AsyncStorage.setItem(THEME_KEY, pref);
  };

  // Cycle the sort: Manual → Streak → To-do → Name → Manual, and remember it.
  const cycleSort = () => {
    const next: SortMode =
      sortMode === 'manual'
        ? 'streak'
        : sortMode === 'streak'
        ? 'todo'
        : sortMode === 'todo'
        ? 'name'
        : 'manual';
    setSortMode(next);
    AsyncStorage.setItem(SORT_KEY, next);
  };

  // --- Backup: export / import all goals + logs as a JSON file ---

  // Write a backup file and open the share sheet so it can be saved/sent.
  const exportData = async () => {
    try {
      const payload = {
        app: 'streaked',
        version: 1,
        exportedAt: new Date().toISOString(),
        goals,
        logs,
      };
      const json = JSON.stringify(payload, null, 2);

      // Write the JSON to a file in the app's cache, then share it.
      const file = new File(Paths.cache, 'streaked-backup.json');
      if (file.exists) file.delete();
      file.create();
      file.write(json);

      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Export', `Backup saved to:\n${file.uri}`);
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: 'Export Streaked backup',
        UTI: 'public.json',
      });
    } catch (e) {
      Alert.alert('Export failed', 'Could not create the backup file.');
    }
  };

  // Pick a backup file, check it, and (after confirming) replace all data.
  const importData = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      const content = await new File(result.assets[0].uri).text();
      const data = JSON.parse(content);

      // Make sure the file really looks like a Streaked backup.
      const goodGoals =
        Array.isArray(data.goals) &&
        data.goals.every(
          (g: any) =>
            g && typeof g.id === 'string' && typeof g.name === 'string',
        );
      const goodLogs =
        Array.isArray(data.logs) &&
        data.logs.every(
          (l: any) =>
            l &&
            typeof l.goalId === 'string' &&
            typeof l.date === 'string' &&
            typeof l.done === 'boolean',
        );
      if (!goodGoals || !goodLogs) {
        Alert.alert(
          'Import failed',
          "That file doesn't look like a Streaked backup.",
        );
        return;
      }

      Alert.alert(
        'Import backup?',
        `This replaces your current ${goals.length} goal(s) and all logs with ` +
          `${data.goals.length} goal(s) from the file. This can't be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Replace',
            style: 'destructive',
            onPress: () => {
              saveGoals(data.goals);
              saveLogs(data.logs);
              Alert.alert('Imported', `Restored ${data.goals.length} goal(s).`);
            },
          },
        ],
      );
    } catch (e) {
      Alert.alert('Import failed', 'Could not read that file.');
    }
  };

  // Ask before deleting, so a goal can't vanish on a single accidental tap.
  const confirmDeleteGoal = (goal: Goal) => {
    Alert.alert(
      'Delete goal?',
      `"${goal.name}" will be removed from your list. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteGoal(goal.id),
        },
      ],
    );
  };

  // --- Renaming a goal ---

  // Start editing: show the goal's name in an input box.
  const startEditGoal = (goal: Goal) => {
    setEditingGoalId(goal.id);
    setEditingText(goal.name);
  };

  // Stop editing without saving.
  const cancelEdit = () => {
    setEditingGoalId(null);
    setEditingText('');
  };

  // Save the new name onto the goal (only the name changes; logs are untouched).
  const saveEdit = (goalId: string) => {
    const name = editingText.trim();
    if (name === '') return; // ignore an empty name — stay in edit mode
    saveGoals(goals.map((g) => (g.id === goalId ? { ...g, name } : g)));
    setEditingGoalId(null);
    setEditingText('');
  };

  // --- Logs: save, read today, tick/untick today ---

  const saveLogs = async (newLogs: DailyLog[]) => {
    setLogs(newLogs);
    await AsyncStorage.setItem(LOGS_KEY, JSON.stringify(newLogs));
  };

  // Is this goal marked done for today?
  const isDoneToday = (goalId: string): boolean => {
    const log = logs.find((l) => l.goalId === goalId && l.date === today);
    return log ? log.done : false;
  };

  // Tick or untick a goal for today. Only TODAY's log is ever touched;
  // logs from previous days are left exactly as they are.
  const toggleToday = (goalId: string) => {
    const existing = logs.find((l) => l.goalId === goalId && l.date === today);

    // Work out the new logs and whether the goal is now done for today.
    let newLogs: DailyLog[];
    let nowDone: boolean;
    if (existing) {
      // Flip done on today's log; every other log stays the same.
      nowDone = !existing.done;
      newLogs = logs.map((l) =>
        l.goalId === goalId && l.date === today ? { ...l, done: nowDone } : l,
      );
    } else {
      // No log for today yet: add one, marked done.
      nowDone = true;
      newLogs = [...logs, { goalId, date: today, done: true }];
    }
    saveLogs(newLogs);

    // If ticking today just landed the streak on a milestone, celebrate.
    if (nowDone) {
      const newStreak = streakFromLogs(newLogs, goalId);
      if (MILESTONES.includes(newStreak)) {
        const goal = goals.find((g) => g.id === goalId);
        const name = goal ? goal.name : 'This goal';
        Alert.alert(
          `🎉 ${newStreak}-day streak!`,
          `${name} is on a ${newStreak}-day streak. Keep it going!`,
        );
      }
    }
  };

  // --- Numbers computed fresh from the logs (never saved anywhere) ---

  // Streak: how many days in a row, counting back from today, this goal is
  // done (0 until today is ticked). Uses the shared helper on the live logs.
  const streakFor = (goalId: string): number => streakFromLogs(logs, goalId);

  // Best streak: the longest run of consecutive done days ever, anywhere in
  // the history (not just up to today). Also computed fresh, never stored.
  const bestStreakFor = (goalId: string): number => {
    const doneDates = new Set(
      logs.filter((l) => l.goalId === goalId && l.done).map((l) => l.date),
    );
    let best = 0;
    doneDates.forEach((date) => {
      // Only count from the START of a run: skip a day if the day before it
      // was also done (that day belongs to a run we've already counted).
      const dayBefore = parseDate(date);
      dayBefore.setDate(dayBefore.getDate() - 1);
      if (doneDates.has(formatDate(dayBefore))) return;
      // Count forward from this start day until the run breaks.
      let run = 0;
      const cursor = parseDate(date);
      while (doneDates.has(formatDate(cursor))) {
        run += 1;
        cursor.setDate(cursor.getDate() + 1);
      }
      if (run > best) best = run;
    });
    return best;
  };

  // Total: how many days this goal was ever done (gaps don't matter).
  const totalFor = (goalId: string): number => {
    return logs.filter((l) => l.goalId === goalId && l.done).length;
  };

  // Was this goal done on a specific day? (used by the history screen)
  const wasDoneOn = (goalId: string, date: string): boolean => {
    return logs.some((l) => l.goalId === goalId && l.date === date && l.done);
  };

  // The goals in the order to show them. Sorting is display-only — it never
  // changes the saved order (that stays as the manual ↑/↓ arrangement).
  // (Defined here, after the helpers it uses like streakFor / isDoneToday.)
  const sortedGoals = [...goals];
  if (sortMode === 'streak') {
    // Highest current streak first (ties keep their existing order).
    sortedGoals.sort((a, b) => streakFor(b.id) - streakFor(a.id));
  } else if (sortMode === 'todo') {
    // Today's not-yet-done goals first.
    sortedGoals.sort(
      (a, b) => Number(isDoneToday(a.id)) - Number(isDoneToday(b.id)),
    );
  } else if (sortMode === 'name') {
    sortedGoals.sort((a, b) => a.name.localeCompare(b.name));
  }

  // --- Reminders (Phase 5) ---

  // Ask the phone for notification permission. Returns true if we're allowed.
  const ensurePermission = async (): Promise<boolean> => {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  };

  // Open the time picker for a goal.
  const startSetReminder = (goalId: string) => {
    setPickingGoalId(goalId);
  };

  // Called when the time picker closes.
  const onTimePicked = async (event: DateTimePickerEvent, date?: Date) => {
    const goalId = pickingGoalId;
    setPickingGoalId(null); // hide the picker

    // 'set' means the user confirmed a time; anything else is a cancel.
    if (event.type !== 'set' || !date || goalId === null) return;

    // Make sure we're allowed to send notifications.
    const allowed = await ensurePermission();
    if (!allowed) {
      Alert.alert(
        'Notifications are off',
        'To get reminders, allow notifications for Streaked in your phone settings, then try again.',
      );
      return;
    }

    // Open the sound picker (with previews); it schedules on selection.
    setSoundPickerFor({
      goalId,
      hour: date.getHours(),
      minute: date.getMinutes(),
    });
  };

  // --- Sound preview + picking (Phase: alarm sounds) ---

  // Stop and release any sound that's currently previewing. Pause first —
  // releasing alone doesn't reliably halt playback, which let sounds overlap.
  const stopPreview = () => {
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }
    const player = previewPlayerRef.current;
    previewPlayerRef.current = null;
    if (player) {
      try {
        player.pause();
      } catch {}
      try {
        player.remove();
      } catch {}
    }
  };

  // Play a short preview of a sound (stops after 15s, or when another starts).
  const previewSound = (sound: (typeof REMINDER_SOUNDS)[number]) => {
    stopPreview();
    const player = createAudioPlayer(sound.preview);
    player.volume = 1.0;
    player.play();
    previewPlayerRef.current = player;
    previewTimeoutRef.current = setTimeout(stopPreview, 15000);
  };

  // Close the picker without choosing.
  const closeSoundPicker = () => {
    stopPreview();
    setSoundPickerFor(null);
  };

  // Choose a sound: stop preview, close the picker, and schedule the reminder.
  const selectSound = (soundKey: string) => {
    const picker = soundPickerFor;
    stopPreview();
    setSoundPickerFor(null);
    if (picker) {
      scheduleReminder(picker.goalId, picker.hour, picker.minute, soundKey);
    }
  };

  // Schedule (or reschedule) a goal's daily reminder with the chosen sound.
  const scheduleReminder = async (
    goalId: string,
    hour: number,
    minute: number,
    soundKey: string,
  ) => {
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return;
    const sound = soundByKey(soundKey);

    try {
      // If this goal already had a reminder, cancel the old one first.
      if (goal.notificationId) {
        await Notifications.cancelScheduledNotificationAsync(goal.notificationId);
      }

      // Schedule a notification that repeats every day at this time, using the
      // channel (and sound) the user picked.
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Streaked reminder',
          body: goal.name,
          sound: sound.file,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute,
          channelId: sound.channelId,
        },
      });

      // Save the reminder details onto the goal.
      saveGoals(
        goals.map((g) =>
          g.id === goalId
            ? {
                ...g,
                reminderHour: hour,
                reminderMinute: minute,
                reminderSound: soundKey,
                notificationId,
              }
            : g,
        ),
      );
    } catch (e) {
      Alert.alert(
        'Could not set reminder',
        'Something went wrong scheduling the notification.',
      );
    }
  };

  // Turn a goal's reminder off: cancel the notification and clear its fields.
  const turnOffReminder = async (goalId: string) => {
    const goal = goals.find((g) => g.id === goalId);
    if (goal && goal.notificationId) {
      await Notifications.cancelScheduledNotificationAsync(goal.notificationId);
    }
    saveGoals(
      goals.map((g) =>
        g.id === goalId
          ? {
              ...g,
              reminderHour: undefined,
              reminderMinute: undefined,
              reminderSound: undefined,
              notificationId: undefined,
            }
          : g,
      ),
    );
  };

  // ===== Calendar screen: one goal's history as a weekly heatmap =====
  if (screen === 'calendar') {
    const goal = goals.find((g) => g.id === calendarGoalId);

    // If the goal was deleted while we're here, just offer a way back.
    if (!goal) {
      return (
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Calendar</Text>
            <Pressable
              style={styles.navButton}
              onPress={() => setScreen('goals')}
            >
              <Text style={styles.navButtonText}>Back</Text>
            </Pressable>
          </View>
          <Text style={styles.empty}>This goal is no longer here.</Text>
          <StatusBar style="auto" />
        </View>
      );
    }

    // Build a grid: one column per week (Sunday–Saturday), the last WEEKS
    // weeks, oldest on the left and this week on the right.
    const WEEKS = 26;
    const now = new Date();
    const thisSunday = new Date(now); // the Sunday that starts this week
    thisSunday.setDate(thisSunday.getDate() - thisSunday.getDay());
    const firstSunday = new Date(thisSunday); // Sunday of the leftmost column
    firstSunday.setDate(firstSunday.getDate() - (WEEKS - 1) * 7);

    type Cell = { date: string; done: boolean; future: boolean };
    const weeks: Cell[][] = [];
    for (let w = 0; w < WEEKS; w++) {
      const week: Cell[] = [];
      for (let d = 0; d < 7; d++) {
        const cellDate = new Date(firstSunday);
        cellDate.setDate(cellDate.getDate() + w * 7 + d);
        const ds = formatDate(cellDate);
        week.push({
          date: ds,
          done: wasDoneOn(goal.id, ds),
          future: cellDate > now, // days after today are left blank
        });
      }
      weeks.push(week);
    }

    const weekdayInitials = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {goal.name}
          </Text>
          <Pressable
            style={styles.navButton}
            onPress={() => setScreen('goals')}
          >
            <Text style={styles.navButtonText}>Back</Text>
          </Pressable>
        </View>
        <Text style={styles.subtitle}>
          🔥 Streak {streakFor(goal.id)}  ·  Best {bestStreakFor(goal.id)}  ·
          {'  '}Total {totalFor(goal.id)}
        </Text>

        <Text style={styles.calCaption}>
          Last {WEEKS} weeks · each square is a day · this week is on the right
        </Text>

        <View style={styles.calArea}>
          {/* Fixed weekday labels down the left */}
          <View style={styles.calWeekdays}>
            {weekdayInitials.map((lbl, i) => (
              <View key={i} style={styles.calLabelSlot}>
                <Text style={styles.calLabelText}>{lbl}</Text>
              </View>
            ))}
          </View>

          {/* The scrollable grid of week-columns (starts at the newest week) */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            ref={calendarScrollRef}
            onContentSizeChange={() =>
              calendarScrollRef.current?.scrollToEnd({ animated: false })
            }
          >
            <View style={styles.calGrid}>
              {weeks.map((week, wi) => (
                <View key={wi} style={styles.calColumn}>
                  {week.map((cell, di) => (
                    <View
                      key={di}
                      style={[
                        styles.calCell,
                        cell.future
                          ? styles.calFuture
                          : cell.done
                          ? styles.calDone
                          : styles.calMiss,
                        cell.date === today && styles.calToday,
                      ]}
                    />
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* Legend */}
        <View style={styles.calLegend}>
          <View style={[styles.calSwatch, styles.calMiss]} />
          <Text style={styles.calLegendText}>Not done</Text>
          <View style={[styles.calSwatch, styles.calDone]} />
          <Text style={styles.calLegendText}>Done</Text>
        </View>

        <StatusBar style="auto" />
      </View>
    );
  }

  // ===== History screen: the last 30 days =====
  if (screen === 'history') {
    // Build the last 30 days, newest first.
    const days: { date: string; label: string }[] = [];
    const cursor = new Date();
    for (let i = 0; i < 30; i++) {
      days.push({ date: formatDate(cursor), label: dayLabel(cursor) });
      cursor.setDate(cursor.getDate() - 1); // step back one day
    }

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Last 30 days</Text>
          <Pressable
            style={styles.navButton}
            onPress={() => setScreen('goals')}
          >
            <Text style={styles.navButtonText}>Back</Text>
          </Pressable>
        </View>

        <FlatList
          data={days}
          keyExtractor={(day) => day.date}
          style={styles.historyList}
          renderItem={({ item }) => (
            <View style={styles.dayCard}>
              <Text style={styles.dayLabel}>
                {item.date === today ? `${item.label} · Today` : item.label}
              </Text>

              {goals.length === 0 ? (
                <Text style={styles.dayEmpty}>No goals yet.</Text>
              ) : (
                goals.map((goal) => {
                  const done = wasDoneOn(goal.id, item.date);
                  return (
                    <View key={goal.id} style={styles.historyRow}>
                      <Text
                        style={[
                          styles.historyMark,
                          done ? styles.markDone : styles.markMissed,
                        ]}
                      >
                        {done ? '✓' : '✗'}
                      </Text>
                      <Text style={styles.historyName}>{goal.name}</Text>
                    </View>
                  );
                })
              )}
            </View>
          )}
        />

        <StatusBar style="auto" />
      </View>
    );
  }

  // ===== Settings screen: appearance + backup =====
  if (screen === 'settings') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <Pressable
            style={styles.navButton}
            onPress={() => setScreen('goals')}
          >
            <Text style={styles.navButtonText}>Back</Text>
          </Pressable>
        </View>

        <Text style={styles.settingsLabel}>Appearance</Text>
        <View style={styles.themeOptions}>
          {THEME_OPTIONS.map((opt) => {
            const active = themePref === opt.key;
            return (
              <Pressable
                key={opt.key}
                style={[styles.themeOption, active && styles.themeOptionActive]}
                onPress={() => chooseTheme(opt.key)}
              >
                <Text
                  style={[
                    styles.themeOptionText,
                    active && styles.themeOptionTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.settingsLabel}>Backup</Text>
        <View style={styles.backupRow}>
          <Pressable style={styles.backupButton} onPress={exportData}>
            <Text style={styles.backupButtonText}>Export backup</Text>
          </Pressable>
          <Pressable style={styles.backupButton} onPress={importData}>
            <Text style={styles.backupButtonText}>Import backup</Text>
          </Pressable>
        </View>

        <StatusBar style="auto" />
      </View>
    );
  }

  // ===== Main screen: today's goals =====
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Goals</Text>
        <View style={styles.headerButtons}>
          <Pressable
            style={styles.settingsButton}
            onPress={() => setScreen('settings')}
          >
            <Text style={styles.settingsButtonText}>⚙️</Text>
          </Pressable>
          <Pressable
            style={styles.navButton}
            onPress={() => setScreen('history')}
          >
            <Text style={styles.navButtonText}>History</Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.subtitle}>Today · {today}</Text>

      {/* Input row: type a goal and press Add */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Enter a goal"
          placeholderTextColor={theme.faint}
          value={text}
          onChangeText={setText}
          onSubmitEditing={addGoal}
        />
        <Pressable style={styles.addButton} onPress={addGoal}>
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>

      {/* Sort control — tap to cycle Manual → Streak → To-do → Name */}
      {goals.length > 0 && (
        <View style={styles.sortRow}>
          <Pressable style={styles.sortButton} onPress={cycleSort}>
            <Text style={styles.sortButtonText}>↕  Sort: {sortLabel}</Text>
          </Pressable>
        </View>
      )}

      {/* The list of goals */}
      <FlatList
        data={sortedGoals}
        keyExtractor={(goal) => goal.id}
        ListEmptyComponent={
          <Text style={styles.empty}>No goals yet. Add one above.</Text>
        }
        renderItem={({ item, index }) => {
          const done = isDoneToday(item.id);
          const streak = streakFor(item.id);
          const best = bestStreakFor(item.id);
          const total = totalFor(item.id);
          const hasReminder =
            item.reminderHour !== undefined &&
            item.reminderMinute !== undefined;
          return (
            <View style={styles.goalRow}>
              {/* Top: while editing this goal, show a name input + Save/Cancel;
                  otherwise the checkbox + name/stats (tap to tick) and the
                  Edit / Delete buttons. */}
              {editingGoalId === item.id ? (
                <View style={styles.editRow}>
                  <TextInput
                    style={styles.editInput}
                    value={editingText}
                    onChangeText={setEditingText}
                    autoFocus
                    onSubmitEditing={() => saveEdit(item.id)}
                  />
                  <Pressable
                    style={styles.editSaveButton}
                    onPress={() => saveEdit(item.id)}
                  >
                    <Text style={styles.editSaveText}>Save</Text>
                  </Pressable>
                  <Pressable style={styles.editCancelButton} onPress={cancelEdit}>
                    <Text style={styles.editCancelText}>Cancel</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.goalTopRow}>
                  <Pressable
                    style={styles.goalMain}
                    onPress={() => toggleToday(item.id)}
                  >
                    <View style={[styles.checkbox, done && styles.checkboxDone]}>
                      {done && <Text style={styles.checkmark}>{'✓'}</Text>}
                    </View>
                    <View style={styles.goalTexts}>
                      <Text style={[styles.goalName, done && styles.goalNameDone]}>
                        {item.name}
                      </Text>
                      <Text style={styles.goalStats}>
                        🔥 Streak {streak}  ·  Best {best}  ·  Total {total}
                      </Text>
                    </View>
                  </Pressable>
                  <View style={styles.goalButtons}>
                    <Pressable
                      style={styles.calButton}
                      onPress={() => openCalendar(item.id)}
                    >
                      <Text style={styles.calButtonText}>📅</Text>
                    </Pressable>
                    <Pressable
                      style={styles.editButton}
                      onPress={() => startEditGoal(item)}
                    >
                      <Text style={styles.editButtonText}>Edit</Text>
                    </Pressable>
                    <Pressable
                      style={styles.deleteButton}
                      onPress={() => confirmDeleteGoal(item)}
                    >
                      <Text style={styles.deleteButtonText}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {/* Bottom: reminder controls on the left, reorder arrows right */}
              <View style={styles.reminderRow}>
                <View style={styles.reminderControls}>
                  {hasReminder ? (
                    <>
                      <Text style={styles.reminderText}>
                        🔔 {formatTime(item.reminderHour!, item.reminderMinute!)}
                        {'  ·  '}
                        {soundByKey(item.reminderSound).label}
                      </Text>
                      <Pressable
                        style={styles.reminderOffButton}
                        onPress={() => turnOffReminder(item.id)}
                      >
                        <Text style={styles.reminderOffText}>Turn off</Text>
                      </Pressable>
                    </>
                  ) : (
                    <Pressable
                      style={styles.reminderSetButton}
                      onPress={() => startSetReminder(item.id)}
                    >
                      <Text style={styles.reminderSetText}>Set reminder</Text>
                    </Pressable>
                  )}
                </View>

                {/* Move up/down — only in Manual sort, where position matters.
                    (Disabled at the list edges.) */}
                {sortMode === 'manual' && (
                  <View style={styles.reorderButtons}>
                    <Pressable
                      style={[
                        styles.reorderButton,
                        index === 0 && styles.reorderDisabled,
                      ]}
                      onPress={() => moveGoal(index, -1)}
                      disabled={index === 0}
                    >
                      <Text style={styles.reorderButtonText}>↑</Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.reorderButton,
                        index === goals.length - 1 && styles.reorderDisabled,
                      ]}
                      onPress={() => moveGoal(index, 1)}
                      disabled={index === goals.length - 1}
                    >
                      <Text style={styles.reorderButtonText}>↓</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          );
        }}
      />

      {/* The time picker only appears while choosing a reminder time */}
      {pickingGoalId !== null && (
        <DateTimePicker
          mode="time"
          value={new Date()}
          onChange={onTimePicked}
        />
      )}

      {/* Sound picker: preview each sound (▶) then tap Use to pick it */}
      <Modal
        visible={soundPickerFor !== null}
        transparent
        animationType="fade"
        onRequestClose={closeSoundPicker}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Choose an alarm sound</Text>
            <Text style={styles.modalHint}>
              Tap ▶ to listen (up to 15s), then Use to pick.
            </Text>
            <ScrollView style={styles.soundList}>
              {REMINDER_SOUNDS.map((s) => (
                <View key={s.key} style={styles.soundRow}>
                  <Pressable
                    style={styles.previewButton}
                    onPress={() => previewSound(s)}
                  >
                    <Text style={styles.previewButtonText}>▶</Text>
                  </Pressable>
                  <Text style={styles.soundName}>{s.label}</Text>
                  <Pressable
                    style={styles.useButton}
                    onPress={() => selectSound(s.key)}
                  >
                    <Text style={styles.useButtonText}>Use</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
            <Pressable style={styles.modalCancel} onPress={closeSoundPicker}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <StatusBar style="auto" />
    </View>
  );
}

// Build the stylesheet for a given theme. Called once per theme (memoized in
// App), so switching light/dark just swaps the colours here.
function makeStyles(theme: Theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.bg,
      paddingHorizontal: 20,
      paddingTop: 56, // leave room below the status bar
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerButtons: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    settingsButton: {
      backgroundColor: theme.surfaceAlt,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginRight: 8,
    },
    settingsButtonText: {
      fontSize: 16,
    },
    settingsLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.muted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 22,
      marginBottom: 10,
    },
    themeOptions: {
      flexDirection: 'row',
      gap: 10,
    },
    themeOption: {
      flex: 1,
      backgroundColor: theme.surfaceAlt,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
    },
    themeOptionActive: {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
    },
    themeOptionText: {
      color: theme.text,
      fontSize: 14,
      fontWeight: 'bold',
    },
    themeOptionTextActive: {
      color: theme.onAccent,
    },
    navButton: {
      backgroundColor: theme.accent,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    navButtonText: {
      color: theme.onAccent,
      fontSize: 14,
      fontWeight: 'bold',
    },
    title: {
      fontSize: 30,
      fontWeight: '700',
      letterSpacing: -0.5,
      color: theme.text,
      flexShrink: 1,
      marginRight: 10,
    },
    subtitle: {
      fontSize: 14,
      color: theme.muted,
      marginTop: 2,
      marginBottom: 20,
    },
    inputRow: {
      flexDirection: 'row',
      marginBottom: 16,
    },
    sortRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginBottom: 14,
    },
    sortButton: {
      backgroundColor: theme.surfaceAlt,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    sortButtonText: {
      color: theme.muted,
      fontSize: 13,
      fontWeight: 'bold',
    },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.inputBg,
      color: theme.text,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      marginRight: 10,
    },
    addButton: {
      backgroundColor: theme.accent,
      borderRadius: 10,
      paddingHorizontal: 18,
      justifyContent: 'center',
    },
    addButtonText: {
      color: theme.onAccent,
      fontSize: 16,
      fontWeight: 'bold',
    },
    goalRow: {
      backgroundColor: theme.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 16,
      marginBottom: 12,
      elevation: 1,
    },
    goalTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    goalMain: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      marginRight: 10,
    },
    checkbox: {
      width: 26,
      height: 26,
      borderRadius: 7,
      borderWidth: 2,
      borderColor: theme.accent,
      marginRight: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxDone: {
      backgroundColor: theme.accent,
    },
    checkmark: {
      color: theme.onAccent,
      fontSize: 16,
      fontWeight: 'bold',
      lineHeight: 18,
    },
    goalTexts: {
      flex: 1,
    },
    goalName: {
      fontSize: 16,
      color: theme.text,
    },
    goalStats: {
      fontSize: 13,
      color: theme.muted,
      marginTop: 3,
    },
    goalNameDone: {
      textDecorationLine: 'line-through',
      color: theme.muted,
    },
    goalButtons: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    calButton: {
      backgroundColor: theme.surfaceAlt,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      marginRight: 8,
    },
    calButtonText: {
      fontSize: 16,
    },
    editButton: {
      backgroundColor: theme.neutral,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
      marginRight: 8,
    },
    editButtonText: {
      color: theme.onNeutral,
      fontSize: 14,
      fontWeight: 'bold',
    },
    deleteButton: {
      backgroundColor: theme.danger,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    deleteButtonText: {
      color: theme.onDanger,
      fontSize: 14,
      fontWeight: 'bold',
    },
    // Renaming a goal
    editRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    editInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.inputBg,
      color: theme.text,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 16,
      marginRight: 8,
    },
    editSaveButton: {
      backgroundColor: theme.accent,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginRight: 8,
    },
    editSaveText: {
      color: theme.onAccent,
      fontSize: 14,
      fontWeight: 'bold',
    },
    editCancelButton: {
      borderWidth: 1,
      borderColor: theme.faint,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    editCancelText: {
      color: theme.muted,
      fontSize: 14,
      fontWeight: 'bold',
    },
    reminderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 12,
    },
    reminderControls: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
    },
    reorderButtons: {
      flexDirection: 'row',
      alignItems: 'center',
      marginLeft: 8,
    },
    reorderButton: {
      backgroundColor: theme.surfaceAlt,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 4,
      marginLeft: 8,
    },
    reorderButtonText: {
      color: theme.text,
      fontSize: 18,
      fontWeight: 'bold',
      lineHeight: 22,
    },
    reorderDisabled: {
      opacity: 0.3,
    },
    reminderText: {
      fontSize: 14,
      color: theme.text,
      marginRight: 12,
    },
    reminderSetButton: {
      borderWidth: 1,
      borderColor: theme.accent,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    reminderSetText: {
      color: theme.accent,
      fontSize: 13,
      fontWeight: 'bold',
    },
    reminderOffButton: {
      borderWidth: 1,
      borderColor: theme.faint,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    reminderOffText: {
      color: theme.muted,
      fontSize: 13,
      fontWeight: 'bold',
    },
    empty: {
      fontSize: 16,
      color: theme.muted,
      textAlign: 'center',
      marginTop: 20,
    },
    backupRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 12,
      marginBottom: 4,
    },
    backupButton: {
      flex: 1,
      backgroundColor: theme.surfaceAlt,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
    },
    backupButtonText: {
      color: theme.text,
      fontSize: 14,
      fontWeight: 'bold',
    },
    // Sound picker modal
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    modalCard: {
      backgroundColor: theme.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 18,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.text,
    },
    modalHint: {
      fontSize: 12,
      color: theme.muted,
      marginTop: 4,
      marginBottom: 12,
    },
    soundList: {
      maxHeight: 320,
    },
    soundRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
    },
    previewButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: theme.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    previewButtonText: {
      color: theme.accent,
      fontSize: 15,
    },
    soundName: {
      flex: 1,
      fontSize: 16,
      color: theme.text,
    },
    useButton: {
      backgroundColor: theme.accent,
      borderRadius: 8,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    useButtonText: {
      color: theme.onAccent,
      fontSize: 14,
      fontWeight: 'bold',
    },
    modalCancel: {
      marginTop: 14,
      alignItems: 'center',
      paddingVertical: 10,
    },
    modalCancelText: {
      color: theme.muted,
      fontSize: 15,
      fontWeight: 'bold',
    },
    // Calendar / heatmap screen
    calCaption: {
      fontSize: 12,
      color: theme.muted,
      marginBottom: 14,
    },
    calArea: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    calWeekdays: {
      marginRight: 6,
    },
    calLabelSlot: {
      height: 16,
      marginBottom: 4,
      justifyContent: 'center',
    },
    calLabelText: {
      fontSize: 10,
      color: theme.faint,
    },
    calGrid: {
      flexDirection: 'row',
    },
    calColumn: {
      marginRight: 4,
    },
    calCell: {
      width: 16,
      height: 16,
      borderRadius: 3,
      marginBottom: 4,
    },
    calDone: {
      backgroundColor: theme.accent,
    },
    calMiss: {
      backgroundColor: theme.heatMiss,
    },
    calFuture: {
      backgroundColor: 'transparent',
    },
    calToday: {
      borderWidth: 2,
      borderColor: theme.todayOutline,
    },
    calSwatch: {
      width: 16,
      height: 16,
      borderRadius: 3,
      marginRight: 6,
    },
    calLegend: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 18,
    },
    calLegendText: {
      fontSize: 13,
      color: theme.muted,
      marginRight: 16,
    },
    // History screen
    historyList: {
      marginTop: 16,
    },
    dayCard: {
      backgroundColor: theme.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 16,
      marginBottom: 12,
      elevation: 1,
    },
    dayLabel: {
      fontSize: 15,
      fontWeight: 'bold',
      color: theme.text,
      marginBottom: 8,
    },
    dayEmpty: {
      fontSize: 14,
      color: theme.muted,
    },
    historyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 3,
    },
    historyMark: {
      fontSize: 15,
      fontWeight: 'bold',
      width: 22,
    },
    markDone: {
      color: theme.accent,
    },
    markMissed: {
      color: theme.faint,
    },
    historyName: {
      fontSize: 15,
      color: theme.text,
      flex: 1,
    },
  });
}
