import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TouchableWithoutFeedback,
  Keyboard,
  Alert,
  Image,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, severityColors, SeverityLevel } from './src/theme/colors';

const API_URL = 'http://10.59.222.207:8000/api/v1/analyze';

interface AlertItem {
  condition: string;
  warning: string;
  severity?: SeverityLevel;
}

interface RecipeDetails {
  ingredients: string[];
  steps: string[];
}

interface AnalysisResponse {
  food_name: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  alerts: AlertItem[];
  recipe_title: string;
  recipe_details: RecipeDetails;
}

export default function App() {
  const [foodName, setFoodName] = useState('');
  const [selectedConditions, setSelectedConditions] = useState<string[]>([]);
  const [customCondition, setCustomCondition] = useState('');
  const [language, setLanguage] = useState<'en' | 'de' | 'fr'>('en');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResponse | null>(null);

  const presetConditions = ['Diabetes', 'Hypertension', 'PCOS', 'Kidney Disease', 'Weight Loss'];

  const toggleCondition = (condition: string) => {
    if (selectedConditions.includes(condition)) {
      setSelectedConditions(selectedConditions.filter((c) => c !== condition));
    } else {
      setSelectedConditions([...selectedConditions, condition]);
    }
  };

  const handleAddCustomCondition = () => {
    const trimmed = customCondition.trim();
    if (trimmed && !selectedConditions.includes(trimmed)) {
      setSelectedConditions([...selectedConditions, trimmed]);
      setCustomCondition('');
    }
  };

  const removeCondition = (condition: string) => {
    setSelectedConditions(selectedConditions.filter((c) => c !== condition));
  };

  const handleResetAll = () => {
    setFoodName('');
    setSelectedConditions([]);
    setCustomCondition('');
    setSelectedImage(null);
    setResult(null);
  };

  const handleSnap = async () => {
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();

    if (!permissionResult.granted) {
      Alert.alert('Permission Needed', 'Camera access is required to take photos of your meal.');
      return;
    }

    const imageResult = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.7,
      base64: true,
    });

    if (!imageResult.canceled && imageResult.assets[0].base64) {
      const base64Data = `data:image/jpeg;base64,${imageResult.assets[0].base64}`;
      setSelectedImage(base64Data);
    }
  };

  const handleAnalyze = async () => {
    if (!foodName.trim() && !selectedImage) {
      Alert.alert('Input Missing', 'Please enter a food item or snap a photo.');
      return;
    }

    Keyboard.dismiss();
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          food_name: foodName.trim() ? foodName.trim() : null,
          image_data: selectedImage,
          selected_conditions: selectedConditions,
          language: language,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server status ${response.status}`);
      }

      const data: AnalysisResponse = await response.json();
      setResult(data);

      if (data.food_name) {
        setFoodName(data.food_name);
      }
    } catch (error) {
      Alert.alert('Connection Error', 'Failed to reach the backend server.');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
          
          {/* Header Bar */}
          <View style={styles.headerBar}>
            <Text style={styles.title}>MealSignal</Text>
            {(foodName || selectedConditions.length > 0 || selectedImage || result) && (
              <TouchableOpacity onPress={handleResetAll} style={styles.clearHeaderButton}>
                <Text style={styles.clearHeaderText}>Reset</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Input & Snap Button */}
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              placeholder="Search food (e.g., Croissant)"
              placeholderTextColor={COLORS.textMuted}
              value={foodName}
              onChangeText={setFoodName}
              returnKeyType="done"
              onSubmitEditing={handleAnalyze}
            />
            <TouchableOpacity style={styles.snapButton} onPress={handleSnap}>
              <Ionicons name="camera" size={20} color="#fff" />
              <Text style={styles.snapButtonText}>Snap</Text>
            </TouchableOpacity>
          </View>

          {/* Image Attachment Preview */}
          {selectedImage && (
            <View style={styles.imagePreviewContainer}>
              <Image source={{ uri: selectedImage }} style={styles.imagePreview} />
              <TouchableOpacity onPress={() => setSelectedImage(null)} style={styles.removeImageBadge}>
                <Text style={styles.removeImageText}>Remove Photo ✕</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Language Selection */}
          <Text style={styles.sectionHeader}>Language:</Text>
          <View style={styles.row}>
            {(['en', 'de', 'fr'] as const).map((lang) => (
              <TouchableOpacity
                key={lang}
                style={[styles.badge, language === lang && styles.activeBadge]}
                onPress={() => setLanguage(lang)}
              >
                <Text style={language === lang ? styles.activeText : styles.badgeText}>
                  {lang.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Pre-set Health Conditions */}
          <Text style={styles.sectionHeader}>Quick Select Conditions:</Text>
          <View style={styles.row}>
            {presetConditions.map((cond) => {
              const selected = selectedConditions.includes(cond);
              return (
                <TouchableOpacity
                  key={cond}
                  style={[styles.badge, selected && styles.activeBadge]}
                  onPress={() => toggleCondition(cond)}
                >
                  <Text style={selected ? styles.activeText : styles.badgeText}>{cond}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Custom Condition Input */}
          <Text style={styles.sectionHeader}>Add Other Condition:</Text>
          <View style={styles.inlineInputRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              placeholder="e.g., Lactose Intolerance"
              placeholderTextColor={COLORS.textMuted}
              value={customCondition}
              onChangeText={setCustomCondition}
              returnKeyType="done"
              onSubmitEditing={handleAddCustomCondition}
            />
            <TouchableOpacity style={styles.addButton} onPress={handleAddCustomCondition}>
              <Text style={styles.addButtonText}>Add</Text>
            </TouchableOpacity>
          </View>

          {/* Selected Conditions List */}
          {selectedConditions.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={styles.boldLabel}>Selected Conditions:</Text>
              <View style={styles.row}>
                {selectedConditions.map((cond) => (
                  <TouchableOpacity
                    key={cond}
                    style={styles.selectedChip}
                    onPress={() => removeCondition(cond)}
                  >
                    <Text style={styles.chipText}>{cond} ✕</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Submit Button */}
          <TouchableOpacity style={styles.button} onPress={handleAnalyze} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Analyze Meal</Text>
            )}
          </TouchableOpacity>

          {/* Results Section */}
          {result && (
            <View style={styles.resultCard}>
              <Text style={styles.resultTitle}>{result.food_name}</Text>
              
              {/* Macro Pills Container */}
              <View style={styles.macroRow}>
                <View style={styles.macroPill}>
                  <Text style={styles.macroPillText}>🔥 {result.kcal} kcal</Text>
                </View>
                <View style={styles.macroPill}>
                  <Text style={styles.macroPillText}>🥩 {result.protein_g}g P</Text>
                </View>
                <View style={styles.macroPill}>
                  <Text style={styles.macroPillText}>🌾 {result.carbs_g}g C</Text>
                </View>
                <View style={styles.macroPill}>
                  <Text style={styles.macroPillText}>🥑 {result.fat_g}g F</Text>
                </View>
              </View>

              {/* Traffic-Light Health Alerts */}
              {result.alerts.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.subHeader}>⚠️ Health Alerts:</Text>
                  {result.alerts.map((item, idx) => {
                    const theme = severityColors(item.severity);
                    return (
                      <View 
                        key={idx} 
                        style={[
                          styles.alertBox, 
                          { backgroundColor: theme.bg, borderColor: theme.border }
                        ]}
                      >
                        <Text style={[styles.alertText, { color: theme.text }]}>
                          • <Text style={{ fontWeight: 'bold' }}>{item.condition}:</Text> {item.warning}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Healthy Recipe Alternative */}
              <View style={styles.section}>
                <Text style={styles.subHeader}>💡 Healthy Alternative: {result.recipe_title}</Text>
                <Text style={styles.boldLabel}>Ingredients:</Text>
                {result.recipe_details.ingredients.map((ing, idx) => (
                  <Text key={idx} style={styles.itemText}>- {ing}</Text>
                ))}

                <Text style={[styles.boldLabel, { marginTop: 8 }]}>Steps:</Text>
                {result.recipe_details.steps.map((step, idx) => (
                  <Text key={idx} style={styles.itemText}>{idx + 1}. {step}</Text>
                ))}
              </View>
            </View>
          )}

          {/* Medical Disclaimer Footer */}
          <View style={styles.disclaimerContainer}>
            <Text style={styles.disclaimerText}>
              ⚕️ <Text style={{ fontWeight: '600' }}>Medical Disclaimer:</Text> MealSignal provides AI-generated nutritional estimates for educational purposes only. It is not a substitute for professional medical advice, diagnosis, or treatment. Always consult a qualified healthcare provider regarding specific dietary requirements.
            </Text>
          </View>

        </ScrollView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContainer: { padding: 20, paddingTop: 20 },
  headerBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 28, fontWeight: 'bold', color: COLORS.textPrimary },
  clearHeaderButton: { backgroundColor: COLORS.badgeBg, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14 },
  clearHeaderText: { color: COLORS.dangerAccent, fontWeight: '600', fontSize: 13 },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  input: {
    backgroundColor: COLORS.card,
    padding: 14,
    borderRadius: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.textPrimary,
  },
  snapButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginLeft: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  snapButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  imagePreviewContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 },
  imagePreview: { width: 50, height: 50, borderRadius: 8 },
  removeImageBadge: { backgroundColor: COLORS.dangerBg, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12 },
  removeImageText: { color: COLORS.dangerAccent, fontWeight: '600', fontSize: 12 },
  sectionHeader: { fontSize: 16, fontWeight: '600', marginVertical: 8, color: COLORS.textSecondary },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12, marginTop: 4 },
  inlineInputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  addButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 10,
    marginLeft: 8,
  },
  addButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  badge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.badgeBg,
    marginRight: 8,
    marginBottom: 8,
  },
  activeBadge: { backgroundColor: COLORS.primary },
  badgeText: { color: COLORS.textPrimary, fontSize: 14 },
  activeText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  selectedChip: {
    backgroundColor: COLORS.chipBg,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  chipText: { color: COLORS.primary, fontWeight: '600', fontSize: 13 },
  button: {
    backgroundColor: COLORS.primary,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginVertical: 16,
  },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  resultCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 18,
    marginTop: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  resultTitle: { fontSize: 22, fontWeight: 'bold', color: COLORS.textPrimary },
  macroRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 10 },
  macroPill: { backgroundColor: COLORS.background, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  macroPillText: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  section: { marginTop: 12 },
  subHeader: { fontSize: 17, fontWeight: 'bold', marginBottom: 8, color: COLORS.textPrimary },
  alertBox: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  alertText: { fontSize: 14, lineHeight: 20 },
  boldLabel: { fontSize: 15, fontWeight: '600', color: COLORS.textSecondary },
  itemText: { fontSize: 14, color: COLORS.textSecondary, marginLeft: 4, marginVertical: 2 },
  disclaimerContainer: { marginTop: 24, paddingVertical: 12, borderTopWidth: 1, borderTopColor: COLORS.border },
  disclaimerText: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', lineHeight: 18 },
});