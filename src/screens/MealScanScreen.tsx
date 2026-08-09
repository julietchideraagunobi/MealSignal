import React, { useState } from 'react';
import { View, Text, Image, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { UserProfile, MealAnalysis, generateConditionFlag } from '../types/nutrition';

export default function MealScanScreen() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [analysis, setAnalysis] = useState<MealAnalysis | null>(null);

  const [userProfile] = useState<UserProfile>({
    conditions: ['hypertension', 'pcos'],
    pcosData: { lastPeriodStart: '2026-08-01', cycleLengthDays: 28 }
  });

  const [pcosEnergy, setPcosEnergy] = useState<'low' | 'okay' | 'good' | null>(null);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0].uri) {
      setImageUri(result.assets[0].uri);
      analyzeMeal();
    }
  };

  const analyzeMeal = async () => {
    setLoading(true);
    
    setTimeout(() => {
      const mockResult: MealAnalysis = {
        foodName: "Grilled Salmon with Seasoned Rice",
        portionEstimate: "1 plate (~350g)",
        calories: 520,
        proteinGrams: 34,
        carbsGrams: 42,
        fatGrams: 18,
        sodiumMg: 780,
        glycemicLoad: 22,
        potassiumMg: 310,
        saturatedFatGrams: 3.5,
        verdict: 'amber'
      };

      mockResult.primaryFlag = generateConditionFlag(mockResult, userProfile);
      setAnalysis(mockResult);
      setLoading(false);
    }, 1500);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>MealSignal</Text>
      
      <TouchableOpacity style={styles.uploadBox} onPress={pickImage}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.previewImage} />
        ) : (
          <Text style={styles.uploadText}>Tap to Scan or Select Food Photo</Text>
        )}
      </TouchableOpacity>

      {loading && <ActivityIndicator size="large" color="#10B981" style={{ marginTop: 20 }} />}

      {analysis && !loading && (
        <View style={styles.resultCard}>
          <Text style={styles.foodName}>{analysis.foodName}</Text>
          <Text style={styles.portionText}>{analysis.portionEstimate}</Text>

          <View style={styles.flagBox}>
            <Text style={styles.flagHeader}>Condition Insight</Text>
            <Text style={styles.flagText}>{analysis.primaryFlag}</Text>
          </View>

          <View style={styles.macroRow}>
            <View style={styles.macroBadge}><Text>{analysis.calories} kcal</Text></View>
            <View style={styles.macroBadge}><Text>P: {analysis.proteinGrams}g</Text></View>
            <View style={styles.macroBadge}><Text>C: {analysis.carbsGrams}g</Text></View>
            <View style={styles.macroBadge}><Text>F: {analysis.fatGrams}g</Text></View>
          </View>

          {userProfile.conditions.includes('pcos') && (
            <View style={styles.pcosSection}>
              <Text style={styles.pcosTitle}>How's your energy right now?</Text>
              <View style={styles.energyRow}>
                {(['low', 'okay', 'good'] as const).map((level) => (
                  <TouchableOpacity
                    key={level}
                    style={[styles.energyBtn, pcosEnergy === level && styles.energyBtnActive]}
                    onPress={() => setPcosEnergy(level)}
                  >
                    <Text style={{ textTransform: 'capitalize' }}>{level}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#F9FAFB', flexGrow: 1 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  uploadBox: { height: 200, backgroundColor: '#E5E7EB', borderRadius: 12, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  uploadText: { color: '#6B7280', fontSize: 16 },
  previewImage: { width: '100%', height: '100%' },
  resultCard: { marginTop: 20, padding: 16, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  foodName: { fontSize: 20, fontWeight: 'bold' },
  portionText: { color: '#6B7280', marginBottom: 12 },
  flagBox: { backgroundColor: '#FEF3C7', padding: 12, borderRadius: 8, marginBottom: 16 },
  flagHeader: { fontWeight: 'bold', color: '#92400E', marginBottom: 4 },
  flagText: { color: '#78350F', fontSize: 14 },
  macroRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  macroBadge: { backgroundColor: '#F3F4F6', padding: 8, borderRadius: 6 },
  pcosSection: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  pcosTitle: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  energyRow: { flexDirection: 'row', gap: 8 },
  energyBtn: { flex: 1, padding: 8, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 6, alignItems: 'center' },
  energyBtnActive: { backgroundColor: '#D1FAE5', borderColor: '#10B981' }
});