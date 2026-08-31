import React, { useState, useEffect, useRef } from 'react';
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
  FlatList,
  Platform,
  ImageStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Purchases, { PurchasesPackage, CustomerInfo } from 'react-native-purchases';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserProfile, MealAnalysis } from '../types/nutrition';

// Live Production Render URL
const API_URL = 'https://mealsignal.onrender.com/api/v1/analyze';
const COACH_API_URL = 'https://mealsignal.onrender.com/api/v1/ai-coach';

const MAX_SCANS_PER_DAY = 3;
const TRIAL_DAYS = 3;

const REVENUECAT_GOOGLE_API_KEY = 'test_RwbWrWFJuZoSYxOuuvZBZOCKohJ';
const REVENUECAT_APPLE_API_KEY = REVENUECAT_GOOGLE_API_KEY;

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
}

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
  const [currentTab, setCurrentTab] = useState<'log' | 'before_eat' | 'coach' | 'profile'>('log');
  const [coachMessages, setCoachMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'ai',
      text: "👋 Hi! I'm your MealSignal AI Coach. Ask me anything about nutrition, meal balance, or healthy recipe ideas!",
    },
  ]);
  const [coachInput, setCoachInput] = useState('');
  const [coachLoading, setCoachLoading] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const [foodName, setFoodName] = useState('');
  const [userName, setUserName] = useState('');
  const [tempName, setTempName] = useState('');
  const [dailyCalorieGoal, setDailyCalorieGoal] = useState('2000');
  const [customCondition, setCustomCondition] = useState('');
  const [customDiet, setCustomDiet] = useState('');
  const [dietaryList, setDietaryList] = useState<string[]>([]);
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

  // RevenueCat states
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [purchaseLoading, setPurchaseLoading] = useState<boolean>(false);

  useEffect(() => {
    const initPurchasesAndData = async () => {
      try {
        // Initialize RevenueCat
        Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
        if (Platform.OS === 'android') {
          await Purchases.configure({ apiKey: REVENUECAT_GOOGLE_API_KEY });
        } else if (Platform.OS === 'ios') {
          await Purchases.configure({ apiKey: REVENUECAT_APPLE_API_KEY });
        }

        const customerInfo = await Purchases.getCustomerInfo();
        if (customerInfo.entitlements.active['pro'] !== undefined) {
          setIsSubscribed(true);
        }
        Purchases.addCustomerInfoUpdateListener((info: CustomerInfo) => {
          if (info.entitlements.active['pro'] !== undefined) {
            setIsSubscribed(true);
          } else {
            setIsSubscribed(false);
          }
        });

        const offerings = await Purchases.getOfferings();
        if (offerings.current && offerings.current.availablePackages.length > 0) {
          setPackages(offerings.current.availablePackages);
        }
      } catch (e) {
        console.log('Error initializing RevenueCat:', e);
      }
    };

    const loadScanData = async () => {
      try {
        const savedDay = await AsyncStorage.getItem('lastScanDay');
        const savedCount = await AsyncStorage.getItem('scanCountToday');
        let savedTrialStart = await AsyncStorage.getItem('trialStartDate');
        const todayStr = new Date().toISOString().split('T')[0];
        const savedName = await AsyncStorage.getItem('user_name');
        if (savedName) {
          setUserName(savedName);
          setTempName(savedName);
        }
        const savedGoal = await AsyncStorage.getItem('daily_calorie_goal');
        if (savedGoal) {
          setDailyCalorieGoal(savedGoal);
        }

        if (!savedTrialStart) {
          savedTrialStart = new Date().toISOString();
          await AsyncStorage.setItem('trialStartDate', savedTrialStart);
        }

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

    initPurchasesAndData();
    loadScanData();
  }, []);

  const handlePurchasePackage = async (pkg: PurchasesPackage) => {
    setPurchaseLoading(true);
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      if (customerInfo.entitlements.active['pro'] !== undefined) {
        setIsSubscribed(true);
        setShowPaywall(false);
        Alert.alert('Success 🎉', 'Welcome to MealSignal Pro!');
      }
    } catch (error: any) {
      if (!error.userCancelled) {
        Alert.alert('Purchase Failed', error.message || 'Could not complete purchase.');
      }
    } finally {
      setPurchaseLoading(false);
    }
  };

  const handleRestorePurchases = async () => {
    setPurchaseLoading(true);
    try {
      const customerInfo = await Purchases.restorePurchases();
      if (customerInfo.entitlements.active['pro'] !== undefined) {
        setIsSubscribed(true);
        setShowPaywall(false);
        Alert.alert('Restored', 'Your Pro subscription has been restored!');
      } else {
        Alert.alert('No Subscription Found', 'We could not find an active Pro subscription for this account.');
      }
    } catch (error: any) {
      Alert.alert('Restore Failed', error.message || 'Could not restore purchases.');
    } finally {
      setPurchaseLoading(false);
    }
  };

  const saveProfileSettings = async () => {
    try {
      await AsyncStorage.setItem('user_name', tempName.trim());
      await AsyncStorage.setItem('daily_calorie_goal', dailyCalorieGoal);
      setUserName(tempName.trim());
      Alert.alert('Saved', 'Profile settings updated successfully!');
    } catch (e) {
      Alert.alert('Error', 'Failed to save profile settings.');
    }
  };

  const handleAddCustomCondition = () => {
    const trimmed = customCondition.trim();
    if (trimmed && !userProfile.conditions.includes(trimmed)) {
      setUserProfile({ ...userProfile, conditions: [...userProfile.conditions, trimmed] });
      setCustomCondition('');
    }
  };

  const removeCondition = (key: string) => {
    setUserProfile({ ...userProfile, conditions: userProfile.conditions.filter((c) => c !== key) });
  };

  const handleAddDietaryFocus = () => {
    const trimmed = customDiet.trim();
    if (trimmed && !dietaryList.includes(trimmed)) {
      setDietaryList([...dietaryList, trimmed]);
      setCustomDiet('');
    }
  };

  const removeDietaryFocus = (item: string) => {
    setDietaryList(dietaryList.filter((d) => d !== item));
  };

  const handleResetAll = () => {
    setFoodName('');
    setImageUri(null);
    setBase64Image(null);
    setAnalysis(null);
    setPortionFeedback(null);
    setPcosEnergy(null);
    setUserProfile({ conditions: [], pcosData: null });
    setDietaryList([]);
    setCustomCondition('');
    setCustomDiet('');
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
        [{ resize: { width: 512 } }], // 512px is ideal for food recognition and uploads 3x faster
        { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG, base64: true }
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
        [{ resize: { width: 512 } }], // 512px is ideal for food recognition and uploads 3x faster
        { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG, base64: true }
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
      const combinedConditions = [...userProfile.conditions, ...dietaryList];

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          food_name: foodName.trim() || null,
          image_data: base64Image,
          conditions: combinedConditions,
          language: language,
          mode: isBeforeYouEat ? 'before_you_eat' : 'standard',
        }),
      });

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
        primaryFlag: data.warning || 'Nutritional breakdown calculated successfully.',
        recipeTitle: data.recipe_title || '',
        recipeIngredients: data.recipe_details?.ingredients || [],
        recipeSteps: data.recipe_details?.steps || [],
      };

      setAnalysis(parsedResult);
     if (!isSubscribed) {
      const todayStr = new Date().toISOString().split('T')[0];
      const newCount = lastScanDay === todayStr ? scanCountToday + 1 : 1;

      setScanCountToday(newCount);
      setLastScanDay(todayStr);

      await AsyncStorage.setItem('lastScanDay', todayStr);
      await AsyncStorage.setItem('scanCountToday', newCount.toString());
      }

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

  const handleSendCoachMessage = async () => {
    const trimmedMessage = coachInput.trim();
    if (!trimmedMessage || coachLoading) {
      return;
    }
    // 🔒 Add this check to gate AI Coach:
    const trialCheck = checkTrialStatus();
    if (!trialCheck.allowed) {
      setPaywallReason('Upgrade to MealSignal Pro to chat with your personal AI Nutrition Coach.');
      setShowPaywall(true);
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: trimmedMessage,
    };

    setCoachMessages((prev) => [...prev, userMessage]);
    setCoachInput('');
    setCoachLoading(true);

    try {
      const response = await fetch(COACH_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: trimmedMessage,
          history: coachMessages.map((m) => ({ sender: m.sender, text: m.text })),
          userContext: {
            name: userName || 'Friend',
            goals: dietaryList.join(', ') || 'Healthy nutrition',
            conditions: userProfile.conditions.join(', '),
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Coach request failed with status ${response.status}`);
      }

      const data = await response.json();
      const coachReply = data.reply || data.message || data.response || 'I could not generate a response right now.';

      setCoachMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          sender: 'ai',
          text: String(coachReply),
        },
      ]);
    } catch (error) {
      setCoachMessages((prev) => [
        ...prev,
        {
          id: `ai-error-${Date.now()}`,
          sender: 'ai',
          text: 'Sorry, I could not reach your nutrition coach right now. Please try again.',
        },
      ]);
    } finally {
      setCoachLoading(false);
    }
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const scansUsedToday = lastScanDay === todayStr ? scanCountToday : 0;
  const scansRemainingToday = Math.max(0, MAX_SCANS_PER_DAY - scansUsedToday);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) {
      return `Good morning${userName ? ', ' + userName : ''}! 🌅`;
    } else if (hour < 18) {
      return `Good afternoon${userName ? ', ' + userName : ''}! ☀️`;
    } else {
      return `Good evening${userName ? ', ' + userName : ''}! 🌙`;
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
         {/* Header Row with Top-Right Profile Icon */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>MealSignal</Text>
              <Text style={styles.greetingText}>{getGreeting()}</Text>
              <Text style={styles.tagline}>Smart Food & Nutrition Analyzer</Text>
            </View>
            <TouchableOpacity
              style={[
                styles.profileHeaderBtn,
                currentTab === 'profile' && styles.profileHeaderBtnActive,
              ]}
              onPress={() => setCurrentTab('profile')}
            >
              <Ionicons
                name={currentTab === 'profile' ? 'person' : 'person-outline'}
                size={22}
                color={currentTab === 'profile' ? '#FFFFFF' : '#10B981'}
              />
            </TouchableOpacity>
          </View>


         {/* Trial / Pro Status Banner */}
          {!isSubscribed ? (
            <TouchableOpacity style={styles.trialBanner} onPress={handleUpgrade}>
              <Text style={styles.trialBannerText}>
                🔒 Trial: {scansRemainingToday}/{MAX_SCANS_PER_DAY} scans remaining today
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.proBanner}>
              <Text style={styles.proBannerText}>✨ MealSignal Pro Active — Unlimited Scans</Text>
            </View>
          )}


             {/* Mode Bar */}
          <View style={styles.modeToggleContainer}>
            <TouchableOpacity
              style={[styles.modeBtn, currentTab === 'log' && styles.activeModeBtn]}
              onPress={() => {
                setCurrentTab('log');
                setIsBeforeYouEat(false);
              }}
            >
              <Text style={currentTab === 'log' ? styles.activeModeText : styles.modeText}>Log Meal</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeBtn, currentTab === 'before_eat' && styles.activeModeBtn]}
              onPress={() => {
                setCurrentTab('before_eat');
                setIsBeforeYouEat(true);
              }}
            >
              <Text style={currentTab === 'before_eat' ? styles.activeModeText : styles.modeText}>Before You Eat 🔍</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeBtn, currentTab === 'coach' && styles.activeModeBtn]}
              onPress={() => setCurrentTab('coach')}
            >
              <Text style={currentTab === 'coach' ? styles.activeModeText : styles.modeText}>AI Coach 💬</Text>
            </TouchableOpacity>
          </View>

          {/* CONDITIONAL RENDER: Profile vs AI Coach vs Scan View */}
          {currentTab === 'profile' ? (
            /* PROFILE & SETTINGS VIEW */
            <View style={styles.profileCard}>
              <Text style={styles.profileSectionHeader}>Personal Details & Goals</Text>

              <Text style={styles.inputLabel}>Your Name</Text>
              <TextInput
                style={styles.profileInput}
                placeholder="Enter your name"
                value={tempName}
                onChangeText={setTempName}
              />

              <Text style={styles.inputLabel}>Daily Calorie Target (kcal)</Text>
              <TextInput
                style={styles.profileInput}
                placeholder="e.g. 2000"
                keyboardType="numeric"
                value={dailyCalorieGoal}
                onChangeText={setDailyCalorieGoal}
              />

              <TouchableOpacity style={styles.saveProfileBtn} onPress={saveProfileSettings}>
                <Text style={styles.saveProfileBtnText}>Save Profile & Goals</Text>
              </TouchableOpacity>

              <View style={styles.divider} />

              <Text style={styles.profileSectionHeader}>Help & Support</Text>
              <TouchableOpacity
                style={styles.settingRow}
                onPress={() => Linking.openURL('mailto:joananthony5991@gmail.com?subject=MealSignal Support')}
              >
                <Ionicons name="mail-outline" size={20} color="#10B981" />
                <Text style={styles.settingRowText}>Contact Support</Text>
                <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
              </TouchableOpacity>

              <View style={styles.divider} />

              <Text style={styles.profileSectionHeader}>About MealSignal</Text>
              <View style={styles.aboutRow}>
                <Text style={styles.aboutLabel}>Version</Text>
                <Text style={styles.aboutValue}>1.0.0 (Production)</Text>
              </View>

              <TouchableOpacity
                style={styles.settingRow}
                onPress={() => Linking.openURL('https://mealsignal.netlify.app/')}
              >
                <Ionicons name="shield-checkmark-outline" size={20} color="#10B981" />
                <Text style={styles.settingRowText}>Privacy Policy</Text>
                <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.settingRow}
                onPress={() => Linking.openURL('https://mealsignal.netlify.app/')}
              >
                <Ionicons name="document-text-outline" size={20} color="#10B981" />
                <Text style={styles.settingRowText}>Terms of Service</Text>
                <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            </View>
          ) : currentTab === 'coach' ? (
            <View style={styles.coachContainer}>
              <ScrollView style={{ maxHeight: 380, marginBottom: 12 }}>
                {coachMessages.map((item) => (
                  <View
                    key={item.id}
                    style={[styles.chatBubble, item.sender === 'user' ? styles.userBubble : styles.aiBubble]}
                  >
                    <Text style={item.sender === 'user' ? styles.userBubbleText : styles.aiBubbleText}>
                      {item.text}
                    </Text>
                  </View>
                ))}
              </ScrollView>

              {coachLoading && (
                <View style={styles.coachLoadingRow}>
                  <ActivityIndicator size="small" color="#10B981" />
                  <Text style={styles.coachLoadingText}>Coach is typing...</Text>
                </View>
              )}

              <View style={styles.coachInputRow}>
                <TextInput
                  style={styles.coachInput}
                  placeholder="Ask your nutrition coach..."
                  value={coachInput}
                  onChangeText={setCoachInput}
                  onSubmitEditing={handleSendCoachMessage}
                />
                <TouchableOpacity
                  style={[styles.coachSendBtn, !coachInput.trim() && { opacity: 0.5 }]}
                  onPress={handleSendCoachMessage}
                  disabled={!coachInput.trim() || coachLoading}
                >
                  <Ionicons name="send" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            /* SCAN & LOG MEAL VIEW */
            <>
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
                  <Ionicons name="camera" size={20} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={pickImage}>
                  <Ionicons name="image" size={20} color="#fff" />
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

              {/* Add Conditions */}
              <Text style={styles.sectionTitle}>Add Conditions:</Text>
              <View style={styles.inlineInputRow}>
                <TextInput
                  style={[styles.searchInput, { marginBottom: 0 }]}
                  placeholder="e.g., Lactose Intolerance, Gluten Sensitive"
                  value={customCondition}
                  onChangeText={setCustomCondition}
                  onSubmitEditing={handleAddCustomCondition}
                />
                <TouchableOpacity style={styles.addBtn} onPress={handleAddCustomCondition}>
                  <Text style={styles.addBtnText}>Add</Text>
                </TouchableOpacity>
              </View>

              {/* Active Condition Chips */}
              {userProfile.conditions.length > 0 && (
                <View style={styles.conditionRow}>
                  {userProfile.conditions.map((cond) => (
                    <TouchableOpacity
                      key={cond}
                      style={styles.selectedChip}
                      onPress={() => removeCondition(cond)}
                    >
                      <Text style={styles.selectedChipText}>{cond} ✕</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Add Dietary Focus */}
              <Text style={styles.sectionTitle}>Add Dietary Focus:</Text>
              <View style={styles.inlineInputRow}>
                <TextInput
                  style={[styles.searchInput, { marginBottom: 0 }]}
                  placeholder="e.g., High Protein, Low Carb, Deficit"
                  value={customDiet}
                  onChangeText={setCustomDiet}
                  onSubmitEditing={handleAddDietaryFocus}
                />
                <TouchableOpacity style={styles.addBtn} onPress={handleAddDietaryFocus}>
                  <Text style={styles.addBtnText}>Add</Text>
                </TouchableOpacity>
              </View>

              {/* Active Dietary Focus Chips */}
              {dietaryList.length > 0 && (
                <View style={styles.conditionRow}>
                  {dietaryList.map((item) => (
                    <TouchableOpacity
                      key={item}
                      style={styles.selectedChip}
                      onPress={() => removeDietaryFocus(item)}
                    >
                      <Text style={styles.selectedChipText}>{item} ✕</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Stacked Action Buttons */}
              <TouchableOpacity style={styles.analyzeBtn} onPress={analyzeMeal} disabled={loading}>
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.analyzeBtnText}>
                    {isBeforeYouEat ? 'Check Before Eating' : 'Analyze Meal'}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.resetButton} onPress={handleResetAll}>
                <Text style={styles.resetText}>🔄 Reset All Fields</Text>
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
                      Nutrition Insight ({analysis.verdict.toUpperCase()})
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
            </>
          )}
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

            {purchaseLoading ? (
              <ActivityIndicator size="large" color="#10B981" style={{ marginVertical: 20 }} />
            ) : (
              <>
                {packages.length > 0 ? (
                  packages.map((pkg) => (
                    <TouchableOpacity
                      key={pkg.identifier}
                      style={pkg.packageType === 'ANNUAL' ? styles.planCardSelected : styles.planCard}
                      onPress={() => handlePurchasePackage(pkg)}
                    >
                      <Text style={styles.planTitle}>{pkg.product.title}</Text>
                      <Text style={styles.planPrice}>
                        {pkg.product.priceString} — {pkg.product.description}
                      </Text>
                    </TouchableOpacity>
                  ))
                ) : (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={{ color: '#6B7280', fontSize: 12, textAlign: 'center' }}>
                      Fetching available subscription plans...
                    </Text>
                  </View>
                )}

                <TouchableOpacity style={styles.restoreBtn} onPress={handleRestorePurchases}>
                  <Text style={styles.restoreBtnText}>Restore Previous Purchase</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity
              style={styles.closePaywallBtn}
              onPress={() => setShowPaywall(false)}
            >
              <Text style={styles.closePaywallText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 26, fontWeight: 'bold', textAlign: 'left', color: '#111827' },
  tagline: { fontSize: 13, textAlign: 'left', color: '#6B7280', marginBottom: 12 },
  greetingText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#10B981',
    textAlign: 'left',
    marginTop: 2,
    marginBottom: 2,
  },

headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  profileHeaderBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  profileHeaderBtnActive: {
    backgroundColor: '#10B981',
    borderColor: '#059669',
  },

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
  modeBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  activeModeBtn: { backgroundColor: '#10B981' },
  modeText: { color: '#374151', fontWeight: '600', fontSize: 12 },
  activeModeText: { color: '#ffffff', fontWeight: 'bold', fontSize: 12 },
  inputRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },

  proBanner: {
    backgroundColor: '#D1FAE5',
    padding: 10,
    borderRadius: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#10B981',
  },
  proBannerText: {
    color: '#065F46',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
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
  previewImage: { width: 60, height: 60, borderRadius: 6 } as const,
  removeImageText: { color: '#EF4444', fontWeight: 'bold', fontSize: 14 },
  sectionTitle: { fontSize: 13, fontWeight: 'bold', color: '#374151', marginBottom: 8, marginTop: 12 },
  chip: { backgroundColor: '#E5E7EB', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#D1D5DB' },
  chipText: { color: '#374151', fontSize: 12, fontWeight: '500' },
  activeChip: { backgroundColor: '#D1FAE5', borderColor: '#10B981' },
  activeChipText: { color: '#047857', fontWeight: '600' },
  conditionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  selectedChip: { backgroundColor: '#D1FAE5', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#10B981' },
  selectedChipText: { color: '#047857', fontSize: 12, fontWeight: '600' },
  analyzeBtn: { backgroundColor: '#10B981', paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginBottom: 12 },
  analyzeBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: 'bold' },
  resetButton: { paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#F3F4F6', marginBottom: 16 },
  resetText: { fontSize: 12, color: '#374151', fontWeight: '600' },
  resultCard: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 16 },
  foodName: { fontSize: 16, fontWeight: 'bold', color: '#111827', marginBottom: 8 },
  portionText: { fontSize: 13, color: '#6B7280', marginBottom: 12 },
  portionBox: { backgroundColor: '#F3F4F6', padding: 12, borderRadius: 8, marginBottom: 12 },
  portionBoxTitle: { fontWeight: 'bold', fontSize: 12, color: '#374151', marginBottom: 8 },
  portionBtnRow: { flexDirection: 'row', gap: 8 },
  portionBtn: { flex: 1, paddingVertical: 8, borderRadius: 6, backgroundColor: '#E5E7EB', alignItems: 'center' },
  portionBtnActive: { backgroundColor: '#10B981' },
  portionBtnText: { fontSize: 11, fontWeight: '600', color: '#374151' },
  flagBox: { padding: 12, borderRadius: 8, marginBottom: 12 },
  flagHeader: { fontWeight: 'bold', fontSize: 12, marginBottom: 6 },
  flagText: { fontSize: 12, lineHeight: 18 },
  macroRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  macroBadge: { backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, minWidth: 72, alignItems: 'center' },
  pcosSection: { backgroundColor: '#F9FAFB', borderRadius: 8, padding: 12, marginBottom: 12 },
  pcosTitle: { fontWeight: 'bold', fontSize: 12, color: '#374151', marginBottom: 8 },
  energyRow: { flexDirection: 'row', gap: 8 },
  energyBtn: { flex: 1, paddingVertical: 8, borderRadius: 6, backgroundColor: '#E5E7EB', alignItems: 'center' },
  energyBtnActive: { backgroundColor: '#10B981' },
  recipeSection: { backgroundColor: '#F9FAFB', borderRadius: 8, padding: 12, marginTop: 12 },
  recipeHeader: { fontSize: 12, fontWeight: 'bold', color: '#0C4A6E', marginBottom: 8 },
  recipeLabel: { fontSize: 12, fontWeight: 'bold', color: '#374151', marginTop: 8, marginBottom: 4 },
  recipeSubText: { fontSize: 12, color: '#374151', marginBottom: 4, lineHeight: 18 },
  disclaimerBox: { backgroundColor: '#F3F4F6', borderRadius: 8, padding: 12, marginTop: 8, borderWidth: 1, borderColor: '#E5E7EB' },
  disclaimerText: { fontSize: 11, color: '#4B5563', lineHeight: 16 },
  paywallOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  paywallCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, width: '90%', alignItems: 'center' },
  paywallTag: { color: '#10B981', fontWeight: 'bold', fontSize: 12, letterSpacing: 1, marginBottom: 8 },
  paywallTitle: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 8, color: '#111827' },
  paywallBody: { fontSize: 13, color: '#4B5563', textAlign: 'center', marginBottom: 16, lineHeight: 18 },
  planCardSelected: { width: '100%', backgroundColor: '#D1FAE5', borderWidth: 2, borderColor: '#10B981', borderRadius: 10, padding: 12, marginBottom: 8 },
  planCard: { width: '100%', backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, padding: 12, marginBottom: 12 },
  planTitle: { fontWeight: 'bold', fontSize: 14, color: '#111827' },
  planPrice: { fontSize: 12, color: '#4B5563', marginTop: 2 },
  closePaywallBtn: { backgroundColor: '#10B981', paddingVertical: 12, borderRadius: 8, width: '100%', alignItems: 'center' },
  closePaywallText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 14 },
  coachContainer: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 16 },
  chatBubble: { marginVertical: 6, maxWidth: '85%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12},
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#10B981', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  aiBubble: { alignSelf: 'flex-start', backgroundColor: '#F3F4F6', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  userBubbleText: { color: '#FFFFFF', fontSize: 13 },
  aiBubbleText: { color: '#374151', fontSize: 13, lineHeight: 19 },
  coachLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 8 },
  coachLoadingText: { color: '#6B7280', fontSize: 12 },
  coachInputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  coachInput: { flex: 1, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, maxHeight: 100 },
  coachSendBtn: { backgroundColor: '#10B981', width: 40, height: 40, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },

  // --- Profile Styles ---
  profileCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 16,
  },
  profileSectionHeader: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 4,
  },
  profileInput: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 12,
    fontSize: 14,
  },
  saveProfileBtn: {
    backgroundColor: '#10B981',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  saveProfileBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 16,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  settingRowText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  aboutLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  aboutValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  restoreBtn: {
    paddingVertical: 8,
    marginBottom: 10,
    alignItems: 'center',
  },
  restoreBtnText: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});