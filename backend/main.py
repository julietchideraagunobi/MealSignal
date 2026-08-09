import os
import json
import base64
from pathlib import Path
from typing import List, Optional, Literal
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from google import genai
from google.genai import types

env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY environment variable is missing!")

client = genai.Client(api_key=GEMINI_API_KEY)

LANGUAGE_MAPPING = {
    "en": "English",
    "de": "German",
    "fr": "French"
}

app = FastAPI(
    title="MealSignal Backend API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AnalysisRequest(BaseModel):
    food_name: Optional[str] = Field(default="Scanned Food", max_length=100)
    image_data: Optional[str] = Field(default=None, description="Base64 encoded JPEG/PNG image string")
    selected_conditions: List[str] = Field(default=[])
    language: Literal["en", "de", "fr"] = Field(
        default="en",
        description="Supported language codes: 'en' (English), 'de' (German), 'fr' (French)"
    )

class AlertItem(BaseModel):
    condition: str = Field(description="The health condition, e.g., 'Diabetes'")
    warning: str = Field(description="The health warning or note for this condition")
    severity: Literal["safe", "caution", "danger"] = Field(
        default="caution", 
        description="Urgency level mapping: safe (green), caution (yellow), danger (red)"
    )

class RecipeDetails(BaseModel):
    ingredients: List[str]
    steps: List[str]

class AnalysisResponse(BaseModel):
    food_name: str
    kcal: int
    protein_g: int
    carbs_g: int
    fat_g: int
    alerts: List[AlertItem]
    recipe_title: str
    recipe_details: RecipeDetails

@app.get("/")
def health_check():
    return {"status": "ok", "message": "MealSignal FastAPI Engine running."}

@app.post("/api/v1/analyze", response_model=AnalysisResponse, status_code=status.HTTP_200_OK)
async def analyze_food(payload: AnalysisRequest):
    food = payload.food_name.strip() if payload.food_name else "Scanned Food"
    conditions = ", ".join(payload.selected_conditions) if payload.selected_conditions else "None"
    target_language = LANGUAGE_MAPPING.get(payload.language, "English")

    prompt = f"""
    You are an expert clinical dietitian and culinary specialist.
    Analyze the meal (provided as text and/or image) for a user with these health conditions: [{conditions}].
    
    Food Hint/Name: "{food}"
    Target Language for ALL output text fields: {target_language}

    CRITICAL ANALYSIS INSTRUCTIONS:
    1. If an image is provided,Identify the exact food item/dish name directly from the image.Replace generic hints like "Scanned Food" or "Unspecified Food Item" (e.g., if a plate has rice, chicken, and salad, recognize each distinct component) ("e.g, "Chips Sour Cream").
    2. Estimate total meal nutrients (calories, protein, carbs, fat) using standard nutrition databases (e.g., USDA standard reference values, official manufacturer packaging labels if visible, or typical portion values for recognized dishes).
    3. Update `food_name` in the response to accurately summarize all identified components (e.g., "Goody's Pepper Sauce (Shito)" or "Grilled Chicken with Brown Rice & Salad").
    4. Evaluate specific health flags tailored ONLY to the user's selected conditions: [{conditions}]. Assign accurate traffic-light severity levels:
       - "safe" (Green)
       - "caution" (Yellow)
       - "danger" (Red)
    5. Provide an authentic, healthier alternative recipe for this dish, including key ingredients and preparation steps.
    6. All output string fields MUST be written in {target_language}.
    """

    contents = [prompt]

    if payload.image_data:
        try:
            raw_base64 = payload.image_data
            if "," in raw_base64:
                raw_base64 = raw_base64.split(",")[1]
            
            image_bytes = base64.b64decode(raw_base64)
            image_part = types.Part.from_bytes(
                data=image_bytes,
                mime_type="image/jpeg"
            )
            contents.append(image_part)
        except Exception as img_err:
            print(f"Failed to process image attachment: {img_err}")

    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=AnalysisResponse,
                temperature=0.2,
            ),
        )

        structured_data = json.loads(response.text)
        return structured_data

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI Analysis failed: {str(e)}"
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)