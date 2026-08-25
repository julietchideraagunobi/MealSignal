import React from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import MealScanScreen from './src/screens/MealScanScreen';

// The screen currently has an incorrect inferred return type, but is used as a
// React component here.
const MealScanComponent = MealScanScreen as unknown as React.ComponentType;

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" />
        <MealScanComponent />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
});