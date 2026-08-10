import React, { useState, useEffect } from 'react';
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
  Modal,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserProfile, MealAnalysis } from '../types/nutrition';

const API_URL = 'https://amendments-pill-everywhere-cgi.trycloudflare.com/api/v1/analyze';

const MAX_SCANS_PER_DAY = 3;
const TRIAL_DAYS = 3;

const UI_TEXT = {
  en: {
    portionQuestion: "Is this portion estimate accurate?",
    energyTitle: "How's your energy right now?",
    healthyAlt: "💡 Healthy Alternative:",
    ingredients: "Ingredients:",
    steps: "Steps:",
  },
  de: {
    portionQuestion: "Ist diese Portionsschätzung genau?",
    energyTitle: "Wie ist deine Energie gerade?",
    healthyAlt: "💡 Gesunde Alternative:",
    ingredients: "Zutaten:",
    steps: "Zubereitung:",
  },
  fr: {
    portionQuestion: "Cette estimation est-elle exacte ?",
    energyTitle: "Comment est votre énergie actuellement ?",
    healthyAlt: "💡 Alternative saine :",
    ingredients: "Ingrédients :",
    steps: "Étapes :",
  },
};

export default function MealScanScreen() {
  const [foodName, setFoodName] = useState('');
  const [customCondition, setCustomCondition] = useState('');
  const [language, setLanguage] = useState<'en' | 'de' | 'fr'>('en');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [base64Image, setBase64Image] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [analysis, setAnalysis] = useState<MealAnalysis | null>(null);

  const [userProfile, setUserProfile] = useState<UserProfile>({
    conditions: [],
    pcosData: null,
  });

  const [isBeforeYouEat, setIsBeforeYouEat] = useState(false);
  const [portionFeedback, setPortionFeedback] = useState<'smaller' | 'right' | 'bigger' | null>(null);
  const [pcosEnergy, setPcosEnergy] = useState<'low' | 'okay' | 'good' | null>(null);

  const [trialStartDate] = useState<Date>(new Date());
  const [lastScanDay, setLastScanDay] = useState<string | null>(null);
  const [scanCountToday, setScanCountToday] = useState<number>(0);
  const [showPaywall, setShowPaywall] = useState<boolean>(false);
  const [paywallReason, setPaywallReason] = useState<string>('');
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);

  // Load persistent scan counts when screen mounts
  useEffect(() => {
    const loadScanData = async () => {
      try {
        const savedDay = await AsyncStorage.getItem('lastScanDay');
        const savedCount = await AsyncStorage.getItem('scanCountToday');
        const todayStr = new Date().toISOString().split('T')[0];

        if (savedDay === todayStr && savedCount !== null) {
          setLastScanDay(savedDay);
          setScanCountToday(parseInt(savedCount, 10));
        } else {
          setLastScanDay(todayStr);
          setScanCountToday(0);
          await AsyncStorage.setItem('lastScanDay', todayStr);
          await AsyncStorage.setItem('scanCountToday', '0');
        }
      } catch (e) {
        console.log('Error loading scan data from AsyncStorage:', e);
      }
    };

    loadScanData();
  }, []);

  const presetConditions = [
    { label: 'Diabetes', key: 'diabetes' },
    { label: 'Hypertension', key: 'hypertension' },
    { label: 'PCOS', key: 'pcos' },
    { label: 'Kidney Disease', key: 'kidney disease' },
    { label: 'High Cholesterol', key: 'high cholesterol' },
  ] as const;

  const toggleCondition = (key: string) => {
    if (userProfile.conditions.includes(key)) {
      setUserProfile({ ...userProfile, conditions: userProfile.conditions.filter((c) => c !== key) });
    } else {
      setUserProfile({ ...userProfile, conditions: [...userProfile.conditions, key] });
    }
  };

  const handleAddCustomCondition = () => {
    const trimmed = customCondition.trim().toLowerCase();
    if (trimmed && !userProfile.conditions.includes(trimmed)) {
      setUserProfile({ ...userProfile, conditions: [...userProfile.conditions, trimmed] });
      setCustomCondition('');
    }
  };

  const removeCondition = (key: string) => {
    setUserProfile({ ...userProfile, conditions: userProfile.conditions.filter((c) => c !== key) });
  };

  const checkTrialStatus = (): { allowed: boolean; reason?: string } => {
    if (isSubscribed) return { allowed: true };

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const daysElapsed = (now.getTime() - trialStartDate.getTime()) / (1000 * 60 * 60 * 24);

    if (daysElapsed > TRIAL_DAYS) {
      return { allowed: false, reason: `Your ${TRIAL_DAYS}-day free trial has expired.` };
    }

    const scansUsedToday = lastScanDay === todayStr ? scanCountToday : 0;
    if (scansUsedToday >= MAX_SCANS_PER_DAY) {
      return { allowed: false, reason: `You've used all ${MAX_SCANS_PER_DAY} free scans for today!` };
    }

    return { allowed: true };
  };

  const handleUpgrade = () => {
    setPaywallReason('Unlock Unlimited Scans');
    setShowPaywall(true);
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0].uri) {
      setImageUri(result.assets[0].uri);

      const compressed = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 800 } }],
        { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      if (compressed.base64) {
        setBase64Image(`data:image/jpeg;base64,${compressed.base64}`);
      }
    }
  };

  const handleSnap = async () => {
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission Needed', 'Camera access is required to take photos of meals.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0].uri) {
      setImageUri(result.assets[0].uri);

      const compressed = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 800 } }],
        { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      if (compressed.base64) {
        setBase64Image(`data:image/jpeg;base64,${compressed.base64}`);
      }
    }
  };

  const analyzeMeal = async () => {
    if (!foodName.trim() && !base64Image) {
      Alert.alert('Input Missing', 'Please enter a food item, scan a meal, or snap ingredient labels.');
      return;
    }

    const trialCheck = checkTrialStatus();
    if (!trialCheck.allowed) {
      setPaywallReason(trialCheck.reason || 'Upgrade to MealSignal Pro for unlimited daily scans.');
      setShowPaywall(true);
      return;
    }

    Keyboard.dismiss();
    setLoading(true);
    setAnalysis(null);
    setPortionFeedback(null);
    setPcosEnergy(null);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          food_name: foodName.trim() || null,
          image_data: base64Image,
          conditions: userProfile.conditions,
          language: language,
          mode: isBeforeYouEat ? 'before_you_eat' : 'standard',
        }),
      });

      // 1. Handle Daily Limit Reached Error
    if (response.status === 403 || response.status === 429) {
      Alert.alert(
        'Daily Limit Reached 📸',
        "You've used all 3 free snaps for today. Upgrade to MealSignal Premium for unlimited meal scans!",
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Upgrade Now', onPress: handleUpgrade },
        ]
      );
      setLoading(false);
      return;
    }

    // 2. Handle generic non-200 errors
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      Alert.alert(
        'Analysis Error',
        errorData?.detail || 'Something went wrong analyzing your food. Please try again.'
      );
      setLoading(false);
      return;
    }

    const data = await response.json();

      const parsedResult: MealAnalysis = {
        foodName: data.food_name || foodName || 'Scanned Food Item',
        portionEstimate: data.portion_estimate || '1 portion (~300g)',
        calories: Number(data.kcal) || 0,
        proteinGrams: Number(data.protein_g) || 0,
        carbsGrams: Number(data.carbs_g) || 0,
        fatGrams: Number(data.fat_g) || 0,
        saturatedFatGrams: Number(data.saturated_fat_g) || 0,
        sodiumMg: Number(data.sodium_mg) || 0,
        potassiumMg: Number(data.potassium_mg) || 0,
        glycemicLoad: Number(data.glycemic_load) || 0,
        verdict: data.verdict || 'green',
        primaryFlag: data.warning || 'No major concerns flagged for your active condition profile.',
        recipeTitle: data.recipe_title || '',
        recipeIngredients: data.recipe_details?.ingredients || [],
        recipeSteps: data.recipe_details?.steps || [],
      };

      setAnalysis(parsedResult);

      const todayStr = new Date().toISOString().split('T')[0];
      const newCount = lastScanDay === todayStr ? scanCountToday + 1 : 1;

      setScanCountToday(newCount);
      setLastScanDay(todayStr);

      await AsyncStorage.setItem('lastScanDay', todayStr);
      await AsyncStorage.setItem('scanCountToday', newCount.toString());

      if (parsedResult.foodName) {
        setFoodName(parsedResult.foodName);
      }
    } catch (error: any) {
      Alert.alert(
        'Connection Error',
        `Could not connect to backend server at ${API_URL}. Ensure your server is active.`
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePortionFeedback = async (type: 'smaller' | 'right' | 'bigger') => {
    setPortionFeedback(type);
    try {
      await fetch(`${API_URL}/portion-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foodName: analysis?.foodName, feedback: type }),
      });
    } catch (e) {
      // Quiet background log
    }
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const scansUsedToday = lastScanDay === todayStr ? scanCountToday : 0;
  const scansRemainingToday = Math.max(0, MAX_SCANS_PER_DAY - scansUsedToday);

  return (
    <View style={{ flex: 1 }}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>MealSignal</Text>
          <Text style={styles.tagline}>Nutrition & Ingredient Insights</Text>

          {/* Trial Banner */}
          {!isSubscribed && (
            <View style={styles.trialBanner}>
              <Text style={styles.trialBannerText}>
                🆓 Trial: {scansRemainingToday}/{MAX_SCANS_PER_DAY} scans remaining today
              </Text>
            </View>
          )}

          {/* Mode Toggle */}
          <View style={styles.modeToggleContainer}>
            <TouchableOpacity
              style={[styles.modeBtn, !isBeforeYouEat && styles.activeModeBtn]}
              onPress={() => setIsBeforeYouEat(false)}
            >
              <Text style={!isBeforeYouEat ? styles.activeModeText : styles.modeText}>Log Meal</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, isBeforeYouEat && styles.activeModeBtn]}
              onPress={() => setIsBeforeYouEat(true)}
            >
              <Text style={isBeforeYouEat ? styles.activeModeText : styles.modeText}>Before You Eat 🔍</Text>
            </TouchableOpacity>
          </View>

          {/* Search Row */}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.searchInput}
              placeholder={isBeforeYouEat ? 'Scan dish/label before eating...' : 'Search food or snap label...'}
              value={foodName}
              onChangeText={setFoodName}
              onSubmitEditing={analyzeMeal}
            />
            <TouchableOpacity style={styles.actionBtn} onPress={handleSnap}>
              <Ionicons name="camera" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={pickImage}>
              <Ionicons name="image" size={18} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Image Preview */}
          {imageUri && (
            <View style={styles.imagePreviewContainer}>
              <Image source={{ uri: imageUri }} style={styles.previewImage} />
              <TouchableOpacity
                onPress={() => {
                  setImageUri(null);
                  setBase64Image(null);
                }}
              >
                <Text style={styles.removeImageText}>Remove Photo ✕</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Language Selector */}
          <Text style={styles.sectionTitle}>Language:</Text>
          <View style={styles.conditionRow}>
            {(['en', 'de', 'fr'] as const).map((lang) => (
              <TouchableOpacity
                key={lang}
                style={[styles.chip, language === lang && styles.activeChip]}
                onPress={() => setLanguage(lang)}
              >
                <Text style={language === lang ? styles.activeChipText : styles.chipText}>
                  {lang.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Active Conditions */}
          <Text style={styles.sectionTitle}>Active Condition Profiles:</Text>
          <View style={styles.conditionRow}>
            {presetConditions.map((item) => {
              const active = userProfile.conditions.includes(item.key);
              return (
                <TouchableOpacity
                  key={item.key}
                  style={[styles.chip, active && styles.activeChip]}
                  onPress={() => toggleCondition(item.key)}
                >
                  <Text style={active ? styles.activeChipText : styles.chipText}>{item.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Custom Condition */}
          <Text style={styles.sectionTitle}>Add Other Condition:</Text>
          <View style={styles.inlineInputRow}>
            <TextInput
              style={[styles.searchInput, { marginBottom: 0 }]}
              placeholder="e.g., Lactose Intolerance, Gluten Free"
              value={customCondition}
              onChangeText={setCustomCondition}
              onSubmitEditing={handleAddCustomCondition}
            />
            <TouchableOpacity style={styles.addBtn} onPress={handleAddCustomCondition}>
              <Text style={styles.addBtnText}>Add</Text>
            </TouchableOpacity>
          </View>

          {/* Selected Conditions Chip List — Excludes Preset Conditions */}
          {userProfile.conditions.filter((c) => !presetConditions.some((p) => p.key === c)).length > 0 && (
            <View style={{ marginTop: 6, marginBottom: 12 }}>
              <View style={styles.conditionRow}>
                {userProfile.conditions
                  .filter((cond) => !presetConditions.some((p) => p.key === cond))
                  .map((cond) => (
                    <TouchableOpacity
                      key={cond}
                      style={styles.selectedChip}
                      onPress={() => removeCondition(cond)}
                    >
                      <Text style={styles.selectedChipText}>{cond} ✕</Text>
                    </TouchableOpacity>
                  ))}
              </View>
            </View>
          )}

          {/* Analyze Trigger Button */}
          <TouchableOpacity style={styles.analyzeBtn} onPress={analyzeMeal} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.analyzeBtnText}>
                {isBeforeYouEat ? 'Check Before Eating' : 'Analyze Meal'}
              </Text>
            )}
          </TouchableOpacity>

          {/* Analysis Display */}
          {analysis && !loading && (
            <View style={styles.resultCard}>
              <Text style={styles.foodName}>{analysis.foodName}</Text>
              <Text style={styles.portionText}>{analysis.portionEstimate}</Text>

              {/* Portion Feedback Loop */}
              <View style={styles.portionBox}>
                <Text style={styles.portionBoxTitle}>{UI_TEXT[language].portionQuestion}</Text>
                <View style={styles.portionBtnRow}>
                  {(['smaller', 'right', 'bigger'] as const).map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[styles.portionBtn, portionFeedback === type && styles.portionBtnActive]}
                      onPress={() => handlePortionFeedback(type)}
                    >
                      <Text style={styles.portionBtnText}>{type === 'right' ? 'About Right' : type}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Verdict Flag */}
              <View
                style={[
                  styles.flagBox,
                  analysis.verdict === 'red' && { backgroundColor: '#FEE2E2' },
                  analysis.verdict === 'green' && { backgroundColor: '#D1FAE5' },
                ]}
              >
                <Text
                  style={[
                    styles.flagHeader,
                    analysis.verdict === 'red' && { color: '#991B1B' },
                    analysis.verdict === 'green' && { color: '#065F46' },
                  ]}
                >
                  Condition Insight ({analysis.verdict.toUpperCase()})
                </Text>
                <Text
                  style={[
                    styles.flagText,
                    analysis.verdict === 'red' && { color: '#7F1D1D' },
                    analysis.verdict === 'green' && { color: '#047857' },
                  ]}
                >
                  {analysis.primaryFlag}
                </Text>
              </View>

              {/* Macronutrient Cards */}
              <View style={styles.macroRow}>
                <View style={styles.macroBadge}>
                  <Text>{analysis.calories} kcal</Text>
                </View>
                <View style={styles.macroBadge}>
                  <Text>P: {analysis.proteinGrams}g</Text>
                </View>
                <View style={styles.macroBadge}>
                  <Text>C: {analysis.carbsGrams}g</Text>
                </View>
                <View style={styles.macroBadge}>
                  <Text>F: {analysis.fatGrams}g</Text>
                </View>
              </View>

              {/* PCOS Energy Track */}
              {userProfile.conditions.includes('pcos') && (
                <View style={styles.pcosSection}>
                  <Text style={styles.pcosTitle}>{UI_TEXT[language].energyTitle}</Text>
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

              {/* Recipe Alternative */}
              {analysis.recipeTitle ? (
                <View style={styles.recipeSection}>
                  <Text style={styles.recipeHeader}>{UI_TEXT[language].healthyAlt} {analysis.recipeTitle}</Text>
                  {analysis.recipeIngredients && analysis.recipeIngredients.length > 0 && (
                    <>
                      <Text style={styles.recipeLabel}>{UI_TEXT[language].ingredients}</Text>
                      {analysis.recipeIngredients.map((ing, idx) => (
                        <Text key={idx} style={styles.recipeSubText}>
                          - {ing}
                        </Text>
                      ))}
                    </>
                  )}
                  {analysis.recipeSteps && analysis.recipeSteps.length > 0 && (
                    <>
                      <Text style={[styles.recipeLabel, { marginTop: 6 }]}>{UI_TEXT[language].steps}</Text>
                      {analysis.recipeSteps.map((step, idx) => (
                        <Text key={idx} style={styles.recipeSubText}>
                          {idx + 1}. {step}
                        </Text>
                      ))}
                    </>
                  )}
                </View>
              ) : null}
            </View>
          )}

          {/* Medical Disclaimer */}
          <View style={styles.disclaimerBox}>
            <Text style={styles.disclaimerText}>
              ⚕️ <Text style={{ fontWeight: 'bold' }}>Medical Disclaimer:</Text> MealSignal provides AI-generated
              nutrition insights for educational purposes only. It is not a medical device.
            </Text>
          </View>
        </ScrollView>
      </TouchableWithoutFeedback>

      {/* Paywall Modal */}
      <Modal visible={showPaywall} animationType="slide" transparent={true}>
        <View style={styles.paywallOverlay}>
          <View style={styles.paywallCard}>
            <Text style={styles.paywallTag}>MEALSIGNAL PRO</Text>
            <Text style={styles.paywallTitle}>{paywallReason || 'Unlock Unlimited Scans'}</Text>
            <Text style={styles.paywallBody}>
              Get unlimited condition-aware meal scans, portion learning, and instant pre-meal insights.
            </Text>

            <TouchableOpacity
              style={styles.planCardSelected}
              onPress={() => {
                setIsSubscribed(true);
                setShowPaywall(false);
              }}
            >
              <Text style={styles.planTitle}>Annual Access — $99.00 / year</Text>
              <Text style={styles.planPrice}>$8.25/month equivalent</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.planCard}
              onPress={() => {
                setIsSubscribed(true);
                setShowPaywall(false);
              }}
            >
              <Text style={styles.planTitle}>Monthly Access — $14.00 / month</Text>
              <Text style={styles.planPrice}>Flexible month-to-month plan</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.closePaywallBtn}
              onPress={() => {
                setIsSubscribed(true);
                setShowPaywall(false);
              }}
            >
              <Text style={styles.closePaywallText}>Unlock Unlimited Access</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#F9FAFB', flexGrow: 1 },
  title: { fontSize: 26, fontWeight: 'bold', textAlign: 'center', color: '#111827' },
  tagline: { fontSize: 13, textAlign: 'center', color: '#6B7280', marginBottom: 12 },
  trialBanner: {
    backgroundColor: '#FEF3C7',
    padding: 10,
    borderRadius: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  trialBannerText: { color: '#92400E', fontSize: 12, fontWeight: 'bold', textAlign: 'center' },
  modeToggleContainer: { flexDirection: 'row', backgroundColor: '#E5E7EB', borderRadius: 8, padding: 4, marginBottom: 16 },
  modeBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  activeModeBtn: { backgroundColor: '#10B981' },
  modeText: { color: '#374151', fontWeight: '600', fontSize: 13 },
  activeModeText: { color: '#ffffff', fontWeight: 'bold', fontSize: 13 },
  inputRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  searchInput: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 44,
  },
  actionBtn: {
    backgroundColor: '#10B981',
    width: 44,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inlineInputRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  addBtn: { backgroundColor: '#10B981', paddingHorizontal: 16, borderRadius: 8, justifyContent: 'center' },
  addBtnText: { color: '#FFFFFF', fontWeight: 'bold' },
  imagePreviewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 12,
  },
  previewImage: { width: 48, height: 48, borderRadius: 6 },
  removeImageText: { color: '#EF4444', fontWeight: '600', fontSize: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  conditionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#E5E7EB' },
  activeChip: { backgroundColor: '#10B981' },
  chipText: { fontSize: 12, color: '#374151' },
  activeChipText: { fontSize: 12, color: '#FFFFFF', fontWeight: 'bold' },
  selectedChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: '#D1FAE5',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  selectedChipText: { fontSize: 12, color: '#065F46', fontWeight: '600' },
  analyzeBtn: { backgroundColor: '#10B981', padding: 14, borderRadius: 8, alignItems: 'center', marginBottom: 16 },
  analyzeBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' },
  resultCard: { padding: 16, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 16 },
  foodName: { fontSize: 20, fontWeight: 'bold' },
  portionText: { color: '#6B7280', marginBottom: 8 },
  portionBox: { backgroundColor: '#F3F4F6', padding: 10, borderRadius: 8, marginVertical: 8 },
  portionBoxTitle: { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 6 },
  portionBtnRow: { flexDirection: 'row', gap: 6 },
  portionBtn: { flex: 1, paddingVertical: 6, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 6, alignItems: 'center', backgroundColor: '#FFFFFF' },
  portionBtnActive: { backgroundColor: '#D1FAE5', borderColor: '#10B981' },
  portionBtnText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  flagBox: { backgroundColor: '#FEF3C7', padding: 12, borderRadius: 8, marginVertical: 8 },
  flagHeader: { fontWeight: 'bold', color: '#92400E', marginBottom: 4 },
  flagText: { color: '#78350F', fontSize: 14 },
  macroRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 8 },
  macroBadge: { backgroundColor: '#F3F4F6', padding: 8, borderRadius: 6 },
  pcosSection: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  pcosTitle: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  energyRow: { flexDirection: 'row', gap: 8 },
  energyBtn: { flex: 1, padding: 8, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 6, alignItems: 'center' },
  energyBtnActive: { backgroundColor: '#D1FAE5', borderColor: '#10B981' },
  recipeSection: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  recipeHeader: { fontWeight: 'bold', fontSize: 14, color: '#111827', marginBottom: 6 },
  recipeLabel: { fontWeight: '600', fontSize: 12, color: '#374151' },
  recipeSubText: { fontSize: 12, color: '#4B5563', marginLeft: 4 },
  disclaimerBox: { marginTop: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  disclaimerText: { fontSize: 11, color: '#6B7280', textAlign: 'center', lineHeight: 16 },
  paywallOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  paywallCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, alignItems: 'center' },
  paywallTag: { color: '#10B981', fontWeight: 'bold', fontSize: 12, letterSpacing: 1, marginBottom: 8 },
  paywallTitle: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 8, color: '#111827' },
  paywallBody: { fontSize: 13, color: '#4B5563', textAlign: 'center', marginBottom: 16, lineHeight: 18 },
  planCardSelected: { width: '100%', backgroundColor: '#D1FAE5', borderWidth: 2, borderColor: '#10B981', borderRadius: 10, padding: 12, marginBottom: 8 },
  planCard: { width: '100%', backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, padding: 12, marginBottom: 12 },
  planTitle: { fontWeight: 'bold', fontSize: 14, color: '#111827' },
  planPrice: { fontSize: 12, color: '#4B5563', marginTop: 2 },
  closePaywallBtn: { backgroundColor: '#10B981', paddingVertical: 12, borderRadius: 8, width: '100%', alignItems: 'center' },
  closePaywallText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 14 },
});