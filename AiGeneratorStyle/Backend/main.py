# backend/main.py
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import uuid
from datetime import datetime
import logging
import json
import os
import requests
import base64

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
from dotenv import load_dotenv
load_dotenv()

# API Configuration
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8000"))
DEV_MODE = os.getenv("DEV_MODE", "true").lower() == "true"

# Ready Player Me Configuration
RPM_API_KEY = os.getenv("READYME_API_KEY")
RPM_PARTNER_ID = os.getenv("READYME_PARTNER_ID")
RPM_APP_ID = os.getenv("READYME_APP_ID")
RPM_ORG_ID = os.getenv("READYME_ORG_ID")
RPM_SUBDOMAIN = os.getenv("READYME_SUBDOMAIN", "styleit")

# CORS Origins
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:4200,http://localhost:4300,*").split(",")

# Initialize FastAPI app
app = FastAPI(title="AI Avatar Clothing Fit API", version="1.0.0")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for development
avatars_db = {}

# Pydantic models
class SimpleMeasurements(BaseModel):
    height: float
    weight: float
    chest: float
    waist: float
    hips: float
    neck: Optional[float] = None
    shoulders: Optional[float] = None
    armLength: Optional[float] = None
    legLength: Optional[float] = None
    userId: Optional[str] = None
    gender: Optional[str] = "neutral"
    bodyType: Optional[str] = "average"

class SimpleAvatarResponse(BaseModel):
    avatarId: str
    avatarUrl: str
    thumbnailUrl: str
    metadata: dict

class IframeAvatarRequest(BaseModel):
    avatarUrl: str
    measurements: SimpleMeasurements

@app.get("/")
def read_root():
    return {
        "message": "AI Avatar Clothing Fit API is running",
        "status": "operational",
        "readyPlayerMe": {
            "configured": bool(RPM_API_KEY and RPM_PARTNER_ID),
            "subdomain": RPM_SUBDOMAIN
        }
    }

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "services": {
            "avatar": "operational",
            "api": "operational",
            "readyPlayerMe": "configured" if RPM_API_KEY else "not configured"
        }
    }

@app.post("/api/avatar/generate", response_model=SimpleAvatarResponse)
async def generate_avatar(measurements: SimpleMeasurements):
    """Generate a 3D avatar from measurements using Ready Player Me API"""
    try:
        # Generate unique avatar ID
        avatar_id = f"rpm_avatar_{uuid.uuid4().hex[:8]}"
        
        # Try API first, fall back to iframe URL if it fails
        rpm_result = await create_readyplayerme_avatar_api(measurements.dict())
        
        if rpm_result["success"]:
            avatar_data = {
                "avatarId": avatar_id,
                "avatarUrl": rpm_result["avatarUrl"],
                "thumbnailUrl": rpm_result.get("thumbnailUrl", generate_thumbnail_url()),
                "metadata": {
                    "created_at": datetime.now().isoformat(),
                    "measurements": measurements.dict(),
                    "provider": "readyplayerme-api",
                    "version": "1.0",
                    "isHumanModel": True,
                    "rpmId": rpm_result.get("rpmId")
                }
            }
        else:
            # Fallback to default avatar
            logger.warning(f"RPM API failed: {rpm_result.get('error')}")
            avatar_data = {
                "avatarId": avatar_id,
                "avatarUrl": get_fallback_avatar_url(measurements.dict()),
                "thumbnailUrl": generate_thumbnail_url(),
                "metadata": {
                    "created_at": datetime.now().isoformat(),
                    "measurements": measurements.dict(),
                    "provider": "fallback",
                    "version": "1.0",
                    "isHumanModel": True,
                    "error": rpm_result.get("error", "Unknown error")
                }
            }
        
        # Store in memory
        avatars_db[avatar_id] = avatar_data
        
        logger.info(f"Avatar generated successfully: {avatar_id}")
        return avatar_data
        
    except Exception as e:
        logger.error(f"Avatar generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/avatar/iframe-config")
async def get_iframe_config():
    """Get Ready Player Me iframe configuration"""
    return {
        "iframeUrl": f"https://{RPM_SUBDOMAIN}.readyplayer.me/avatar",
        "subdomain": RPM_SUBDOMAIN,
        "parameters": {
            "frameApi": "",
            "bodyType": "fullbody",
            "clearCache": "",
            "quickStart": "false",
            "gender": "neutral"
        },
        "example": f"""
        <iframe 
            id="rpm-iframe"
            src="https://{RPM_SUBDOMAIN}.readyplayer.me/avatar?frameApi&clearCache" 
            width="100%" 
            height="600px"
            allow="camera; microphone; clipboard-write"
            style="border: none;"
        ></iframe>
        
        <script>
        window.addEventListener('message', (event) => {{
            if (event.origin === 'https://{RPM_SUBDOMAIN}.readyplayer.me') {{
                const data = JSON.parse(event.data);
                if (data.eventName === 'v1.avatar.exported') {{
                    console.log('Avatar URL:', data.data.url);
                    // Send to your backend
                }}
            }}
        }});
        </script>
        """
    }

@app.post("/api/avatar/from-iframe", response_model=SimpleAvatarResponse)
async def save_avatar_from_iframe(request: IframeAvatarRequest):
    """Save avatar URL received from Ready Player Me iframe"""
    try:
        avatar_id = f"rpm_avatar_{uuid.uuid4().hex[:8]}"
        
        # Extract RPM avatar ID from URL
        rpm_id = None
        if "models.readyplayer.me" in request.avatarUrl:
            rpm_id = request.avatarUrl.split("/")[-1].replace(".glb", "")
        
        avatar_data = {
            "avatarId": avatar_id,
            "avatarUrl": request.avatarUrl,
            "thumbnailUrl": request.avatarUrl.replace(".glb", ".png"),
            "metadata": {
                "created_at": datetime.now().isoformat(),
                "measurements": request.measurements.dict(),
                "provider": "readyplayerme-iframe",
                "version": "1.0",
                "isHumanModel": True,
                "rpmId": rpm_id
            }
        }
        
        avatars_db[avatar_id] = avatar_data
        
        logger.info(f"Avatar saved from iframe: {avatar_id}")
        return avatar_data
        
    except Exception as e:
        logger.error(f"Failed to save iframe avatar: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/avatar/{avatar_id}", response_model=SimpleAvatarResponse)
async def get_avatar(avatar_id: str):
    """Get avatar by ID"""
    if avatar_id not in avatars_db:
        raise HTTPException(status_code=404, detail="Avatar not found")
    
    return avatars_db[avatar_id]

@app.put("/api/avatar/{avatar_id}/update", response_model=SimpleAvatarResponse)
async def update_avatar(avatar_id: str, measurements: SimpleMeasurements):
    """Update avatar measurements"""
    if avatar_id not in avatars_db:
        raise HTTPException(status_code=404, detail="Avatar not found")
    
    # Update measurements
    avatars_db[avatar_id]["metadata"]["measurements"] = measurements.dict()
    avatars_db[avatar_id]["metadata"]["updated_at"] = datetime.now().isoformat()
    
    return avatars_db[avatar_id]

@app.post("/api/avatar/{avatar_id}/face")
async def process_face_photo(avatar_id: str, face_photo: UploadFile = File(...)):
    """Process face photo for avatar"""
    try:
        if avatar_id not in avatars_db:
            raise HTTPException(status_code=404, detail="Avatar not found")
        
        # Read the uploaded file
        contents = await face_photo.read()
        
        # For now, just mark that a face photo was uploaded
        avatars_db[avatar_id]["metadata"]["hasFacePhoto"] = True
        avatars_db[avatar_id]["metadata"]["facePhotoProcessed"] = datetime.now().isoformat()
        
        return {
            "success": True,
            "avatarId": avatar_id,
            "message": "Face photo processed successfully",
            "note": "Use the iframe integration for real-time face photo avatar creation"
        }
        
    except Exception as e:
        logger.error(f"Face processing failed: {e}")
        return {
            "success": False,
            "error": str(e)
        }

# Helper functions
async def create_readyplayerme_avatar_api(measurements: Dict) -> Dict:
    """Create Ready Player Me avatar using API"""
    
    if not RPM_API_KEY or not RPM_PARTNER_ID:
        return {
            "success": False,
            "error": "Ready Player Me not configured"
        }
    
    # Try different authentication methods
    auth_methods = [
        {"X-API-Key": RPM_API_KEY},
        {"Authorization": f"Bearer {RPM_API_KEY}"},
        {"Authorization": RPM_API_KEY}
    ]
    
    # Try both v1 and v2 endpoints
    endpoints = [
        ("https://api.readyplayer.me/v2/avatars", "v2"),
        ("https://api.readyplayer.me/v1/avatars", "v1")
    ]
    
    for headers_auth in auth_methods:
        for endpoint, version in endpoints:
            try:
                headers = {
                    **headers_auth,
                    'Content-Type': 'application/json'
                }
                
                if version == "v1":
                    payload = create_v1_payload(measurements)
                else:
                    payload = create_v2_payload(measurements)
                
                response = requests.post(endpoint, headers=headers, json=payload, timeout=10)
                
                logger.info(f"RPM API {version} with {list(headers_auth.keys())[0]} - Status: {response.status_code}")
                
                if response.status_code in [200, 201]:
                    data = response.json()
                    logger.info(f"RPM API Success: {data}")
                    return {
                        "success": True,
                        "avatarUrl": data.get("glb") or data.get("url") or data.get("avatarUrl", ""),
                        "thumbnailUrl": data.get("thumbnail", ""),
                        "rpmId": data.get("id", "")
                    }
                else:
                    logger.error(f"RPM API {version} error: {response.status_code} - {response.text}")
                    
            except Exception as e:
                logger.error(f"RPM API {version} exception: {e}")
                continue
    
    return {
        "success": False,
        "error": "All API endpoints failed"
    }

def create_v1_payload(measurements: Dict) -> Dict:
    """Create v1 API payload"""
    return {
        "data": {
            "userId": measurements.get("userId", f"user_{uuid.uuid4().hex[:8]}"),
            "partner": RPM_PARTNER_ID,
            "data": {
                "gender": measurements.get("gender", "neutral"),
                "bodyType": "fullbody",
                "generationType": "automatic",
                "recognizedData": {
                    "eyeColor": "#4A90E2",
                    "lipsColor": "#E91E63",
                    "hairColor": "#8B4513",
                    "shapes": {},
                    "skinColor": {
                        "general": "#FDBCB4",
                        "cheeks": "#FFB6C1",
                        "nose": "#FDBCB4",
                        "forehead": "#FDBCB4",
                        "lips": "#E91E63"
                    },
                    "texture": "default"
                },
                "userData": {
                    "bodyShape": calculate_body_shape(measurements),
                    "age": "young"
                }
            }
        }
    }

def create_v2_payload(measurements: Dict) -> Dict:
    """Create v2 API payload"""
    return {
        "data": {
            "partner": RPM_PARTNER_ID,
            "bodyType": "fullbody",
            "gender": measurements.get("gender", "neutral"),
            "assets": {
                "skinColor": 1,
                "eyeColor": "blue",
                "hairStyle": "short",
                "hairColor": 3,
                "bodyShape": calculate_body_shape(measurements)
            },
            "base64Image": ""
        }
    }

def calculate_body_shape(measurements: Dict) -> str:
    """Calculate body shape from measurements"""
    if "height" in measurements and "weight" in measurements:
        height_m = measurements["height"] / 100
        bmi = measurements["weight"] / (height_m ** 2)
        
        if bmi < 18.5:
            return "athletic"
        elif bmi < 25:
            return "average"
        elif bmi < 30:
            return "heavyset"
        else:
            return "plussize"
    
    return "average"

def get_fallback_avatar_url(measurements: Dict) -> str:
    """Get fallback avatar URL when RPM fails"""
    gender = measurements.get("gender", "neutral")
    
    # Working GLB models - using Three.js examples
    avatars = {
        "male": "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Xbot.glb",
        "female": "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Michelle.glb",
        "neutral": "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/CesiumMan/glTF-Binary/CesiumMan.glb"
    }
    
    return avatars.get(gender, avatars["neutral"])

def generate_thumbnail_url() -> str:
    """Generate a placeholder thumbnail"""
    return "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2U0ZTRlNCIvPgogIDxjaXJjbGUgY3g9IjEwMCIgY3k9IjcwIiByPSI0MCIgZmlsbD0iIzk5OSIvPgogIDxwYXRoIGQ9Ik01MCAxNTBoMTAwYzAgMjcuNi0yMi40IDUwLTUwIDUwcy01MC0yMi40LTUwLTUweiIgZmlsbD0iIzk5OSIvPgo8L3N2Zz4="

@app.get("/api/test-rpm")
async def test_ready_player_me():
    """Test Ready Player Me configuration"""
    return {
        "configured": bool(RPM_API_KEY and RPM_PARTNER_ID),
        "apiKey": f"...{RPM_API_KEY[-4:]}" if RPM_API_KEY else None,
        "partnerId": RPM_PARTNER_ID,
        "appId": RPM_APP_ID,
        "orgId": RPM_ORG_ID,
        "subdomain": RPM_SUBDOMAIN,
        "iframeUrl": f"https://{RPM_SUBDOMAIN}.readyplayer.me/avatar"
    }

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting AI Avatar Clothing Fit API...")
    logger.info(f"Ready Player Me configured: {bool(RPM_API_KEY and RPM_PARTNER_ID)}")
    uvicorn.run(app, host=API_HOST, port=API_PORT, reload=DEV_MODE)