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

// A single goal. A goal only needs an id and a name
// (no dates, streaks, or reminders here).
type Goal = {
  id: string;
  name: string;
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

// Format a Date as YYYY-MM-DD, using the phone's local time.
function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Goals</Text>
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

      {/* The list: tap a goal to tick it for today; Delete removes the goal */}
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
          return (
            <View style={styles.goalRow}>
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
          );
        }}
      />

      {/* Temporary debug button — will be removed in a later phase */}
      <Pressable style={styles.debugButton} onPress={showAllLogs}>
        <Text style={styles.debugButtonText}>Show saved logs (debug)</Text>
      </Pressable>

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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f2f2f2',
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
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
});
