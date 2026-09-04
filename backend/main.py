import os
import json
import time
import base64
import asyncio
import httpx
from pathlib import Path
from datetime import date, datetime, timezone
from typing import List, Optional, Literal
from fastapi import FastAPI, HTTPException, status, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from sqlalchemy import create_engine, Column, String, Integer
from sqlalchemy.orm import declarative_base, sessionmaker, Session

# 1. Environment & Config
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY is missing from backend/.env")
client = genai.Client(api_key=GEMINI_API_KEY)

# 2. Google OAuth Client IDs
VALID_CLIENT_IDS = [
    cid for cid in [
        os.getenv("GOOGLE_CLIENT_ID_ANDROID"),
        os.getenv("GOOGLE_CLIENT_ID_IOS"),
        os.getenv("GOOGLE_CLIENT_ID_WEB"),
    ] if cid
]
if not VALID_CLIENT_IDS:
    raise ValueError("No GOOGLE_CLIENT_ID_* values set in backend/.env")

# 3. RevenueCat Config
REVENUECAT_SECRET_API_KEY = os.getenv("REVENUECAT_SECRET_API_KEY")
REVENUECAT_WEBHOOK_SECRET = os.getenv("REVENUECAT_WEBHOOK_SECRET")
if not REVENUECAT_SECRET_API_KEY:
    raise ValueError("REVENUECAT_SECRET_API_KEY is missing from backend/.env")
if not REVENUECAT_WEBHOOK_SECRET:
    raise ValueError("REVENUECAT_WEBHOOK_SECRET is missing from backend/.env")

TRIAL_DAYS = 3
TRIAL_SCANS_PER_DAY = 3

# 4. PostgreSQL Database Engine
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./mealsignal.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class UserRecord(Base):
    __tablename__ = "users"
    google_sub = Column(String, primary_key=True, index=True)
    email = Column(String, nullable=True)
    scans_today = Column(Integer, default=0)
    last_scan_date = Column(String, default=str(date.today()))
    trial_start_date = Column(String, default=str(date.today()))
    is_pro = Column(Integer, default=0)

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

LANGUAGE_MAPPING = {"en": "English", "de": "German", "fr": "French"}

app = FastAPI(title="MealSignal Backend API", version="1.0.2")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 5. Auth Dependency
async def get_current_user(
    authorization: str = Header(...),
    db: Session = Depends(get_db)
) -> UserRecord:
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header"
        )
    token = authorization.split(" ", 1)[1]

    try:
        idinfo = id_token.verify_oauth2_token(token, google_requests.Request())
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google token"
        )

    if idinfo.get("aud") not in VALID_CLIENT_IDS:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token audience"
        )

    sub = idinfo["sub"]
    email = idinfo.get("email", "")

    user = db.query(UserRecord).filter(UserRecord.google_sub == sub).first()
    if not user:
        today_str = str(date.today())
        user = UserRecord(
            google_sub=sub,
            email=email,
            scans_today=0,
            last_scan_date=today_str,
            trial_start_date=today_str,
            is_pro=0
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return user


# 6. RevenueCat Helper
async def check_revenuecat_pro_status(google_sub: str) -> bool:
    url = f"https://api.revenuecat.com/v1/subscribers/{google_sub}"
    headers = {"Authorization": f"Bearer {REVENUECAT_SECRET_API_KEY}"}
    async with httpx.AsyncClient() as client_http:
        resp = await client_http.get(url, headers=headers)
    if resp.status_code != 200:
        return False
    data = resp.json()
    entitlements = data.get("subscriber", {}).get("entitlements", {})
    pro_entitlement = entitlements.get("pro")
    if not pro_entitlement:
        return False
    expires_date = pro_entitlement.get("expires_date")
    if expires_date is None:
        return True
    return datetime.fromisoformat(expires_date.replace("Z", "+00:00")) > datetime.now(timezone.utc)


# 7. Request & Response Schemas
class AnalysisRequest(BaseModel):
    food_name: Optional[str] = Field(default=None, max_length=100)
    image_data: Optional[str] = Field(default=None)
    conditions: List[str] = Field(default=[])
    language: Literal["en", "de", "fr"] = Field(default="en")
    mode: Optional[str] = Field(default="standard")

class RecipeDetails(BaseModel):
    ingredients: List[str]
    steps: List[str]

class RawAnalysis(BaseModel):
    food_name: str
    portion_estimate: str
    kcal: int
    protein_g: int
    carbs_g: int
    fat_g: int
    sodium_mg: int
    potassium_mg: int = 0
    phosphorus_mg: int = 0
    saturated_fat_g: int = 0
    glycemic_load: int
    recipe_title: str
    recipe_details: RecipeDetails

class AnalysisResponse(BaseModel):
    food_name: str
    portion_estimate: str
    kcal: int
    protein_g: int
    carbs_g: int
    fat_g: int
    saturated_fat_g: int
    sodium_mg: int
    potassium_mg: int
    glycemic_load: int
    verdict: Literal["green", "amber", "red"]
    warning: str
    recipe_title: str
    recipe_details: RecipeDetails

class PortionFeedbackRequest(BaseModel):
    foodName: Optional[str] = None
    feedback: str

class ChatMessage(BaseModel):
    sender: str
    text: str

class AICoachRequest(BaseModel):
    prompt: str
    history: List[ChatMessage] = Field(default=[])
    userContext: Optional[dict] = Field(default={})


THRESHOLDS = {
    "hypertension": {"field": "sodium_mg", "amber_at": 300, "red_at": 500, "label": "sodium"},
    "kidney disease": {"field": "potassium_mg", "amber_at": 300, "red_at": 500, "label": "potassium"},
    "high cholesterol": {"field": "saturated_fat_g", "amber_at": 4, "red_at": 7, "label": "saturated fat"},
    "diabetes": {"field": "glycemic_load", "amber_at": 15, "red_at": 25, "label": "glycemic load"},
    "pcos": {"field": "glycemic_load", "amber_at": 12, "red_at": 22, "label": "glycemic load"},
}

WARNING_TEMPLATES = {
    "en": {
        "sodium": "Elevated sodium ({value}mg) — balance with plenty of water and potassium-rich foods.",
        "potassium": "Potassium estimate: {value}mg.",
        "saturated fat": "Higher saturated fat ({value}g) — consider pairing with lean sides.",
        "glycemic load": "Higher glycemic impact (~{value}) — pair with healthy fats or protein to steady absorption.",
        "default_green": "Nutritional breakdown calculated successfully."
    },
    "de": {
        "sodium": "Erhöhter Natriumgehalt ({value}mg) — trinken Sie ausreichend Wasser.",
        "potassium": "Kaliumschätzung: {value}mg.",
        "saturated fat": "Höhere gesättigte Fettsäuren ({value}g).",
        "glycemic load": "Höhere glykämische Last (~{value}) — mit Protein oder gesunden Fetten kombinieren.",
        "default_green": "Nährwertanalyse erfolgreich berechnet."
    },
    "fr": {
        "sodium": "Teneur en sodium ({value}mg) — veillez à bien vous hydrater.",
        "potassium": "Estimation du potassium: {value}mg.",
        "saturated fat": "Acides gras saturés ({value}g).",
        "glycemic load": "Impact glycémique plus élevé (~{value}) — associez avec des protéines.",
        "default_green": "Analyse nutritionnelle calculée avec succès."
    }
}

def evaluate_conditions(raw: dict, conditions: list[str], lang: str = "en") -> tuple[str, str]:
    worst_severity = "green"
    worst_message = None
    severity_rank = {"green": 0, "amber": 1, "red": 2}
    lang_templates = WARNING_TEMPLATES.get(lang, WARNING_TEMPLATES["en"])

    for cond in conditions:
        cond_key = cond.strip().lower()
        rule = THRESHOLDS.get(cond_key)
        if not rule:
            continue

        value = raw.get(rule["field"], 0)
        if value >= rule["red_at"]:
            severity = "red"
        elif value >= rule["amber_at"]:
            severity = "amber"
        else:
            severity = "green"

        if severity_rank[severity] > severity_rank[worst_severity]:
            worst_severity = severity
            template = lang_templates[rule["label"]]
            worst_message = template.format(value=value)

    if worst_message is None:
        worst_message = lang_templates["default_green"]

    return worst_severity, worst_message


# 8. Endpoints
@app.get("/")
def read_root():
    return {"status": "MealSignal API is live"}


@app.post("/api/v1/analyze", response_model=AnalysisResponse, status_code=status.HTTP_200_OK)
async def analyze_food(
    payload: AnalysisRequest, 
    user: UserRecord = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    t_start = time.time()
    today_date = date.today()
    today_str = str(today_date)

    # Server-Side Trial Check (Verify eligibility WITHOUT incrementing yet)
    if not user.is_pro:
        trial_start = datetime.strptime(user.trial_start_date, "%Y-%m-%d").date()
        days_since_start = (today_date - trial_start).days

        if days_since_start >= TRIAL_DAYS:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Free trial period ended. Please upgrade to Pro."
            )

        scans_today = user.scans_today if user.last_scan_date == today_str else 0

        if scans_today >= TRIAL_SCANS_PER_DAY:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Daily scan limit reached. Come back tomorrow."
            )

    food = payload.food_name.strip() if payload.food_name else "Scanned Food Item"
    user_conditions = ", ".join(payload.conditions) if payload.conditions else "None"
    target_language = LANGUAGE_MAPPING.get(payload.language, "English")

    prompt = f"""
    You are an expert AI Food & Nutrition Analyzer.

    Food Hint/Name: "{food}"
    Mode: {payload.mode}
    User Dietary Focus, Preferences & Conditions: {user_conditions}
    Target Language for ALL text fields: {target_language}

    INSTRUCTIONS:
    1. If an image is provided, accurately identify the food/dish name.
    2. Estimate total meal nutrients: kcal, protein_g, carbs_g, fat_g, sodium_mg,
       potassium_mg, phosphorus_mg, saturated_fat_g, glycemic_load.
    3. Update `food_name` accurately (e.g., "Grilled Chicken Bowl").
    4. Provide `portion_estimate` (e.g., "1 bowl (~350g)").
    5. Provide a balanced, nutrient-dense recipe suggestion (`recipe_title`, `ingredients`, `steps`)
       tailored to the scanned meal and aligning with any user dietary focus or conditions.
       Keep `ingredients` to max 3-4 key items and `steps` to exactly 4 short sentences.
    6. All text output MUST be in {target_language}.
    """

    t0 = time.time()
    contents = [prompt]
    if payload.image_data:
        try:
            raw_base64 = payload.image_data
            if "," in raw_base64:
                raw_base64 = raw_base64.split(",")[1]
            image_bytes = base64.b64decode(raw_base64)
            image_part = types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")
            contents.append(image_part)
        except Exception as img_err:
            print(f"Failed to process image attachment: {img_err}")
    print(f"⏱️ Image prep took: {time.time() - t0:.2f}s")

    primary_config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=RawAnalysis,
        temperature=0.1,
        max_output_tokens=500,
        thinking_config=types.ThinkingConfig(
            thinking_budget=0  # Zero reasoning turns -> instant JSON
        ),
    )

    response = None
    last_error = None
    t1 = time.time()

    # Tier 1: Try gemini-3.8-flash
    try:
        response = await asyncio.to_thread(
            client.models.generate_content,
            model="gemini-3.8-flash",
            contents=contents,
            config=primary_config,
        )
    except Exception as e1:
        last_error = e1
        print(f"Primary (3.8 Flash) failed: {e1}. Trying gemini-3.6-flash fallback...")
        # Tier 2: High-capacity fallback to gemini-3.6-flash
        try:
            response = await asyncio.to_thread(
                client.models.generate_content,
                model="gemini-3.6-flash",
                contents=contents,
                config=primary_config,
            )
        except Exception as e2:
            last_error = e2
            print(f"Fallback (3.6 Flash) failed: {e2}. Trying gemini-3.5-flash...")
            # Tier 3: Final fallback to gemini-3.5-flash
            try:
                response = await asyncio.to_thread(
                    client.models.generate_content,
                    model="gemini-3.5-flash",
                    contents=contents,
                    config=primary_config,
                )
            except Exception as e3:
                last_error = e3
                print(f"Final fallback failed: {e3}")

    if not response or not response.text:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI Analysis failed: {str(last_error)}"
        )

    print(f"⏱️ Gemini API call took: {time.time() - t1:.2f}s")

    t2 = time.time()
    raw_data = json.loads(response.text)
    print(f"⏱️ JSON parsing took: {time.time() - t2:.2f}s")

    # Increment scan count ONLY AFTER successful analysis
    if not user.is_pro:
        scans_today = user.scans_today if user.last_scan_date == today_str else 0
        user.scans_today = scans_today + 1
        user.last_scan_date = today_str
        db.commit()

    verdict, warning = evaluate_conditions(raw_data, payload.conditions, payload.language)

    final_response = {
        "food_name": raw_data["food_name"],
        "portion_estimate": raw_data["portion_estimate"],
        "kcal": raw_data["kcal"],
        "protein_g": raw_data["protein_g"],
        "carbs_g": raw_data["carbs_g"],
        "fat_g": raw_data["fat_g"],
        "saturated_fat_g": raw_data["saturated_fat_g"],
        "sodium_mg": raw_data["sodium_mg"],
        "potassium_mg": raw_data["potassium_mg"],
        "glycemic_load": raw_data["glycemic_load"],
        "verdict": verdict,
        "warning": warning,
        "recipe_title": raw_data["recipe_title"],
        "recipe_details": raw_data["recipe_details"],
    }
    print(f"🚀 TOTAL Backend execution: {time.time() - t_start:.2f}s")
    return final_response


@app.post("/api/v1/ai-coach")
async def ai_coach(
    payload: AICoachRequest, 
    user: UserRecord = Depends(get_current_user)
):
    if not payload.prompt.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Prompt cannot be empty"
        )

    user_name = payload.userContext.get("name", "Friend") if payload.userContext else "Friend"
    user_goals = payload.userContext.get("goals", "Health & nutrition tracking") if payload.userContext else "General wellness"

    system_instruction = f"""You are MealSignal AI Coach, a supportive, knowledgeable, and empathetic nutrition assistant.
User Name: {user_name}
User Goals: {user_goals}

Guidelines:
- Provide encouraging, practical nutrition and meal planning advice.
- Keep answers concise, clear, and scannable (1-3 short paragraphs or bullet points).
- If giving recommendations, emphasize balanced whole foods and healthy habits.
"""

    conversation_text = ""
    for msg in payload.history[-6:]:
        role_label = "User" if msg.sender == "user" else "Coach"
        conversation_text += f"{role_label}: {msg.text}\n"

    final_prompt = f"{conversation_text}User: {payload.prompt}\nCoach:"

    coach_config = types.GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=0.7,
        max_output_tokens=700,
        thinking_config=types.ThinkingConfig(
            thinking_budget=0
        ),
    )

    response = None
    last_error = None

    # Tier 1: Try gemini-3.8-flash
    try:
        response = await asyncio.to_thread(
            client.models.generate_content,
            model="gemini-3.8-flash",
            contents=final_prompt,
            config=coach_config,
        )
    except Exception as e1:
        last_error = e1
        print(f"Coach primary (3.8 Flash) failed: {e1}. Trying gemini-3.6-flash fallback...")
        # Tier 2: Fallback to gemini-3.6-flash
        try:
            response = await asyncio.to_thread(
                client.models.generate_content,
                model="gemini-3.6-flash",
                contents=final_prompt,
                config=coach_config,
            )
        except Exception as e2:
            last_error = e2
            print(f"Final coach fallback failed: {e2}")

    if not response or not response.text:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI Coach failed: {str(last_error)}"
        )

    return {"reply": response.text.strip()}


@app.post("/api/v1/revenuecat-webhook")
async def revenuecat_webhook(
    payload: dict, 
    authorization: str = Header(default=""),
    db: Session = Depends(get_db)
):
    auth_token = authorization.replace("Bearer ", "").strip()
    expected_token = REVENUECAT_WEBHOOK_SECRET.replace("Bearer ", "").strip()
    if auth_token != expected_token:
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    event = payload.get("event", {})
    app_user_id = event.get("app_user_id")
    event_type = event.get("type")

    if not app_user_id:
        raise HTTPException(status_code=400, detail="Missing app_user_id")

    grants_pro = event_type in ("INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE", "TRANSFER")
    revokes_pro = event_type in ("EXPIRATION",)

    user = db.query(UserRecord).filter(UserRecord.google_sub == app_user_id).first()
    if user:
        if grants_pro:
            user.is_pro = 1
        elif revokes_pro:
            user.is_pro = 0
        db.commit()

    return {"status": "ok"}


@app.post("/api/v1/refresh-pro-status")
async def refresh_pro_status(
    user: UserRecord = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    is_pro = await check_revenuecat_pro_status(user.google_sub)
    user.is_pro = 1 if is_pro else 0
    db.commit()
    return {"is_pro": is_pro}


@app.post("/api/v1/analyze/portion-feedback")
async def portion_feedback(payload: PortionFeedbackRequest):
    print(f"Portion feedback received for '{payload.foodName}': {payload.feedback}")
    return {"status": "ok", "message": "Feedback recorded"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)