import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
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
  },
  {
    key: 'effect',
    label: 'Sound effect',
    file: 'vibration_sound_effect.wav',
    channelId: 'reminders-effect',
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

export default function App() {
  // The text currently typed in the input box.
  const [text, setText] = useState('');
  // The list of goals.
  const [goals, setGoals] = useState<Goal[]>([]);
  // Every daily log we have saved.
  const [logs, setLogs] = useState<DailyLog[]>([]);
  // Which screen is showing: the goals list or the history.
  const [screen, setScreen] = useState<'goals' | 'history'>('goals');
  // The goal we're currently picking a reminder time for (null = picker hidden).
  const [pickingGoalId, setPickingGoalId] = useState<string | null>(null);

  const today = todayString();

  // Load the saved goals and logs once, when the app starts.
  useEffect(() => {
    AsyncStorage.getItem(GOALS_KEY).then((stored) => {
      if (stored !== null) setGoals(JSON.parse(stored));
    });
    AsyncStorage.getItem(LOGS_KEY).then((stored) => {
      if (stored !== null) setLogs(JSON.parse(stored));
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
    const existing = logs.find(
      (l) => l.goalId === goalId && l.date === today,
    );

    if (existing) {
      // Flip done on today's log; every other log stays the same.
      const newLogs = logs.map((l) =>
        l.goalId === goalId && l.date === today ? { ...l, done: !l.done } : l,
      );
      saveLogs(newLogs);
    } else {
      // No log for today yet: add one, marked done.
      const newLog: DailyLog = { goalId, date: today, done: true };
      saveLogs([...logs, newLog]);
    }
  };

  // --- Numbers computed fresh from the logs (never saved anywhere) ---

  // Streak: how many days in a row, counting back from today, this goal
  // is done. The first day that is missing or not done (starting at today)
  // stops the count — so if today isn't ticked yet, the streak is 0.
  const streakFor = (goalId: string): number => {
    // The set of dates this goal was marked done.
    const doneDates = new Set(
      logs.filter((l) => l.goalId === goalId && l.done).map((l) => l.date),
    );
    let streak = 0;
    const cursor = new Date(); // start at today and walk backwards
    while (doneDates.has(formatDate(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1); // go to the previous day
    }
    return streak;
  };

  // Total: how many days this goal was ever done (gaps don't matter).
  const totalFor = (goalId: string): number => {
    return logs.filter((l) => l.goalId === goalId && l.done).length;
  };

  // Was this goal done on a specific day? (used by the history screen)
  const wasDoneOn = (goalId: string, date: string): boolean => {
    return logs.some((l) => l.goalId === goalId && l.date === date && l.done);
  };

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

    // Ask which alarm sound to use, then schedule the reminder.
    const hour = date.getHours();
    const minute = date.getMinutes();
    Alert.alert('Choose an alarm sound', undefined, [
      ...REMINDER_SOUNDS.map((s) => ({
        text: s.label,
        onPress: () => scheduleReminder(goalId, hour, minute, s.key),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
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

  // --- Temporary debug button: test an alarm sound right now ---

  // Prints the real Android channel settings to the Metro console, then lets
  // you fire a test notification 3 seconds later so you can hear the sound.
  const testAlarm = async () => {
    const allowed = await ensurePermission();
    if (!allowed) {
      Alert.alert('Notifications are off', 'Allow notifications for Streaked first.');
      return;
    }
    // Show what each channel actually has (sound + importance) in the terminal.
    const channels = await Notifications.getNotificationChannelsAsync();
    console.log('NOTIFICATION CHANNELS:', JSON.stringify(channels, null, 2));

    Alert.alert(
      'Test alarm',
      'Pick a sound. It fires in 3 seconds — lock your phone to hear it as a real reminder.',
      [
        ...REMINDER_SOUNDS.map((s) => ({
          text: s.label,
          onPress: () => fireTestSound(s),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  };

  const fireTestSound = async (sound: (typeof REMINDER_SOUNDS)[number]) => {
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Test alarm', body: sound.label, sound: sound.file },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 3,
        channelId: sound.channelId,
      },
    });
  };

  // --- Temporary debug button: show every saved log in a popup ---

  const showAllLogs = () => {
    if (logs.length === 0) {
      Alert.alert('Saved logs', 'No logs yet.');
      return;
    }
    // Turn each log into a readable line: date, tick mark, goal name.
    const lines = logs.map((l) => {
      const goal = goals.find((g) => g.id === l.goalId);
      const name = goal ? goal.name : '(deleted goal)';
      const mark = l.done ? '✓' : '✗'; // ✓ or ✗
      return `${l.date}  ${mark}  ${name}`;
    });
    Alert.alert(`Saved logs (${logs.length})`, lines.join('\n'));
  };

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

  // ===== Main screen: today's goals =====
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Goals</Text>
        <Pressable
          style={styles.navButton}
          onPress={() => setScreen('history')}
        >
          <Text style={styles.navButtonText}>History</Text>
        </Pressable>
      </View>
      <Text style={styles.subtitle}>Today · {today}</Text>

      {/* Input row: type a goal and press Add */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Enter a goal"
          value={text}
          onChangeText={setText}
          onSubmitEditing={addGoal}
        />
        <Pressable style={styles.addButton} onPress={addGoal}>
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>

      {/* The list of goals */}
      <FlatList
        data={goals}
        keyExtractor={(goal) => goal.id}
        ListEmptyComponent={
          <Text style={styles.empty}>No goals yet. Add one above.</Text>
        }
        renderItem={({ item }) => {
          const done = isDoneToday(item.id);
          const streak = streakFor(item.id);
          const total = totalFor(item.id);
          const hasReminder =
            item.reminderHour !== undefined &&
            item.reminderMinute !== undefined;
          return (
            <View style={styles.goalRow}>
              {/* Top: checkbox + name/stats (tap to tick), and Delete */}
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
                      🔥 Streak {streak}  ·  Total {total}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  style={styles.deleteButton}
                  onPress={() => deleteGoal(item.id)}
                >
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </Pressable>
              </View>

              {/* Bottom: the daily reminder controls */}
              <View style={styles.reminderRow}>
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
            </View>
          );
        }}
      />

      {/* Temporary debug buttons — will be removed in a later phase */}
      <Pressable style={styles.debugButton} onPress={testAlarm}>
        <Text style={styles.debugButtonText}>Test alarm now (debug)</Text>
      </Pressable>
      <Pressable style={styles.debugButton} onPress={showAllLogs}>
        <Text style={styles.debugButtonText}>Show saved logs (debug)</Text>
      </Pressable>

      {/* The time picker only appears while choosing a reminder time */}
      {pickingGoalId !== null && (
        <DateTimePicker
          mode="time"
          value={new Date()}
          onChange={onTimePicked}
        />
      )}

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 60, // leave room below the status bar
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navButton: {
    backgroundColor: '#0e7a4f',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  navButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginTop: 2,
    marginBottom: 20,
  },
  inputRow: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginRight: 10,
  },
  addButton: {
    backgroundColor: '#0e7a4f',
    borderRadius: 8,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  goalRow: {
    backgroundColor: '#f2f2f2',
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
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
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#0e7a4f',
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: {
    backgroundColor: '#0e7a4f',
  },
  checkmark: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    lineHeight: 18,
  },
  goalTexts: {
    flex: 1,
  },
  goalName: {
    fontSize: 16,
  },
  goalStats: {
    fontSize: 13,
    color: '#666',
    marginTop: 3,
  },
  goalNameDone: {
    textDecorationLine: 'line-through',
    color: '#888',
  },
  deleteButton: {
    backgroundColor: '#c0392b',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  reminderText: {
    fontSize: 14,
    color: '#333',
    marginRight: 12,
  },
  reminderSetButton: {
    borderWidth: 1,
    borderColor: '#0e7a4f',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  reminderSetText: {
    color: '#0e7a4f',
    fontSize: 13,
    fontWeight: 'bold',
  },
  reminderOffButton: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  reminderOffText: {
    color: '#555',
    fontSize: 13,
    fontWeight: 'bold',
  },
  empty: {
    fontSize: 16,
    color: '#888',
    textAlign: 'center',
    marginTop: 20,
  },
  debugButton: {
    borderWidth: 1,
    borderColor: '#bbb',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginVertical: 12,
  },
  debugButtonText: {
    color: '#555',
    fontSize: 14,
  },
  // History screen
  historyList: {
    marginTop: 16,
  },
  dayCard: {
    backgroundColor: '#f2f2f2',
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
  },
  dayLabel: {
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  dayEmpty: {
    fontSize: 14,
    color: '#888',
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
    color: '#0e7a4f',
  },
  markMissed: {
    color: '#c7c7c7',
  },
  historyName: {
    fontSize: 15,
    flex: 1,
  },
});
