export interface UserProfile {
  conditions: string[];
  pcosData?: {
    lastPeriodStart: string;
    cycleLengthDays: number;
  } | null;
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
  verdict: 'green' | 'amber' | 'red';
  primaryFlag?: string;
  recipeTitle?: string;
  recipeIngredients?: string[];
  recipeSteps?: string[];
}