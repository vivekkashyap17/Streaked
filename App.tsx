import { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';

// A single goal. For now we only need an id and a name
// (no dates, streaks, or reminders yet).
type Goal = {
  id: string;
  name: string;
};

// The key we use to store the goals list on the device.
const STORAGE_KEY = 'goals';

export default function App() {
  // The text currently typed in the input box.
  const [text, setText] = useState('');
  // The list of goals shown on screen.
  const [goals, setGoals] = useState<Goal[]>([]);

  // Load the saved goals once, when the app starts.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored !== null) {
        setGoals(JSON.parse(stored));
      }
    });
  }, []);

  // Save a new goals list to the device AND update the screen.
  const saveGoals = async (newGoals: Goal[]) => {
    setGoals(newGoals);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newGoals));
  };

  // Add the typed goal to the list.
  const addGoal = () => {
    const name = text.trim();
    if (name === '') {
      return; // ignore empty input
    }
    const newGoal: Goal = {
      id: Date.now().toString(), // simple unique id
      name: name,
    };
    saveGoals([...goals, newGoal]);
    setText(''); // clear the input box
  };

  // Remove a goal by its id.
  const deleteGoal = (id: string) => {
    saveGoals(goals.filter((goal) => goal.id !== id));
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Goals</Text>

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

      {/* The list of goals, each with a delete button */}
      <FlatList
        data={goals}
        keyExtractor={(goal) => goal.id}
        ListEmptyComponent={
          <Text style={styles.empty}>No goals yet. Add one above.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.goalRow}>
            <Text style={styles.goalName}>{item.name}</Text>
            <Pressable
              style={styles.deleteButton}
              onPress={() => deleteGoal(item.id)}
            >
              <Text style={styles.deleteButtonText}>Delete</Text>
            </Pressable>
          </View>
        )}
      />

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
  goalName: {
    fontSize: 16,
    flex: 1,
    marginRight: 10,
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
});
