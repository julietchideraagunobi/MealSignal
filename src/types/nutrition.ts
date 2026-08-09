export type HealthCondition = 'diabetes' | 'hypertension' | 'kidney_disease' | 'high_cholesterol' | 'pcos';

export interface UserProfile {
  conditions: HealthCondition[];
  pcosData?: {
    lastPeriodStart?: string;
    cycleLengthDays?: number;
  };
}

export interface MealAnalysis {
  foodName: string;
  portionEstimate: string;
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
  sodiumMg: number;
  glycemicLoad: number;
  potassiumMg: number;
  saturatedFatGrams: number;
  primaryFlag?: string;
  verdict: 'green' | 'amber' | 'red';
}

export function generateConditionFlag(meal: MealAnalysis, profile: UserProfile): string {
  const flags: string[] = [];

  if (profile.conditions.includes('hypertension') && meal.sodiumMg > 600) {
    flags.push("High sodium content — keep an eye on blood pressure targets today.");
  }
  if ((profile.conditions.includes('diabetes') || profile.conditions.includes('pcos')) && meal.glycemicLoad > 20) {
    flags.push("High glycemic load — consider pairing with protein or fiber to steady your response.");
  }
  if (profile.conditions.includes('kidney_disease') && meal.potassiumMg > 400) {
    flags.push("Elevated potassium levels — track carefully against your daily kidney target.");
  }
  if (profile.conditions.includes('high_cholesterol') && meal.saturatedFatGrams > 5) {
    flags.push("Higher saturated fat — balance this out with lean choices later today.");
  }

  return flags.length > 0 
    ? flags.join(" ") 
    : "Balanced meal profile for your selected health tracking preferences.";
}
