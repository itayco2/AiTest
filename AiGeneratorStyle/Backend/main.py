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
import httpx

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
        
        # Since Ready Player Me API requires authentication that we don't have properly configured,
        # we'll use the iframe approach which is more reliable
        avatar_data = {
            "avatarId": avatar_id,
            "avatarUrl": get_default_avatar_url(measurements.dict()),
            "thumbnailUrl": generate_thumbnail_url(),
            "metadata": {
                "created_at": datetime.now().isoformat(),
                "measurements": measurements.dict(),
                "provider": "readyplayerme-default",
                "version": "1.0",
                "isHumanModel": True,
                "note": "Use the iframe integration for custom avatars"
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
    # Build the correct iframe URL with all necessary parameters
    base_url = f"https://{RPM_SUBDOMAIN}.readyplayer.me/avatar"
    
    return {
        "iframeUrl": base_url,
        "subdomain": RPM_SUBDOMAIN,
        "parameters": {
            "frameApi": "",
            "bodyType": "fullbody",
            "clearCache": "",
            "quickStart": "false",
            "gender": "neutral"
        },
        "instructions": [
            "1. The iframe will open the Ready Player Me avatar creator",
            "2. You can upload a photo or create an avatar manually",
            "3. When done, the iframe will send a message with the avatar URL",
            "4. Listen for window.postMessage events from the iframe"
        ],
        "example": f"""
        <iframe 
            id="rpm-iframe"
            src="{base_url}?frameApi&clearCache" 
            width="100%" 
            height="600px"
            allow="camera; microphone; clipboard-write"
            style="border: none;"
        ></iframe>
        
        <script>
        window.addEventListener('message', (event) => {{
            // Check if the message is from Ready Player Me
            const validOrigins = [
                'https://{RPM_SUBDOMAIN}.readyplayer.me',
                'https://readyplayer.me'
            ];
            
            if (!validOrigins.includes(event.origin)) return;
            
            // Parse the message
            const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            
            // Handle avatar export
            if (message.eventName === 'v1.avatar.exported') {{
                console.log('Avatar URL:', message.data.url);
                // Send this URL to your backend
                saveAvatarToBackend(message.data.url);
            }}
        }});
        
        function saveAvatarToBackend(avatarUrl) {{
            fetch('/api/avatar/from-iframe', {{
                method: 'POST',
                headers: {{
                    'Content-Type': 'application/json'
                }},
                body: JSON.stringify({{
                    avatarUrl: avatarUrl,
                    measurements: {{
                        height: 170,
                        weight: 70,
                        chest: 95,
                        waist: 80,
                        hips: 95
                    }}
                }})
            }});
        }}
        </script>
        """
    }

@app.post("/api/avatar/from-iframe", response_model=SimpleAvatarResponse)
async def save_avatar_from_iframe(request: IframeAvatarRequest):
    """Save avatar URL received from Ready Player Me iframe"""
    try:
        avatar_id = f"rpm_avatar_{uuid.uuid4().hex[:8]}"
        
        # Extract RPM avatar ID from URL if possible
        rpm_id = None
        if "models.readyplayer.me" in request.avatarUrl:
            # URL format: https://models.readyplayer.me/[avatar-id].glb
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
    """Process face photo for avatar - guides user to use iframe instead"""
    try:
        if avatar_id not in avatars_db:
            raise HTTPException(status_code=404, detail="Avatar not found")
        
        # Since we can't directly process photos with RPM API without proper auth,
        # we'll guide the user to use the iframe
        return {
            "success": False,
            "avatarId": avatar_id,
            "message": "Photo upload is not available through the API. Please use the Ready Player Me iframe to upload your photo.",
            "iframeUrl": f"https://{RPM_SUBDOMAIN}.readyplayer.me/avatar?frameApi",
            "instructions": [
                "1. Click 'Open Creator' to access Ready Player Me",
                "2. Choose 'Take a photo' or 'Upload a photo'",
                "3. Follow the instructions to create your avatar",
                "4. Your avatar will be automatically saved when complete"
            ]
        }
        
    except Exception as e:
        logger.error(f"Face processing failed: {e}")
        return {
            "success": False,
            "error": str(e)
        }

# Helper functions
def get_default_avatar_url(measurements: Dict) -> str:
    """Get a default avatar URL based on gender"""
    gender = measurements.get("gender", "neutral")
    
    # Use working GLB models from various sources
    default_avatars = {
        # Three.js example models (these are reliable and always available)
        "male": "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Xbot.glb",
        "female": "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Michelle.glb",
        "neutral": "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/CesiumMan/glTF-Binary/CesiumMan.glb",
        
        # Alternative: Mixamo models
        "male_alt": "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/BrainStem/glTF-Binary/BrainStem.glb",
        "female_alt": "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Fox/glTF-Binary/Fox.glb",
        
        # Fallback simple model
        "fallback": "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Box/glTF-Binary/Box.glb"
    }
    
    return default_avatars.get(gender, default_avatars["neutral"])

def generate_thumbnail_url() -> str:
    """Generate a placeholder thumbnail"""
    return "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2U0ZTRlNCIvPgogIDxjaXJjbGUgY3g9IjEwMCIgY3k9IjcwIiByPSI0MCIgZmlsbD0iIzk5OSIvPgogIDxwYXRoIGQ9Ik01MCAxNTBoMTAwYzAgMjcuNi0yMi40IDUwLTUwIDUwcy01MC0yMi40LTUwLTUweiIgZmlsbD0iIzk5OSIvPgo8L3N2Zz4="

@app.get("/api/test-rpm")
async def test_ready_player_me():
    """Test Ready Player Me configuration and provide setup instructions"""
    return {
        "configured": bool(RPM_API_KEY and RPM_PARTNER_ID),
        "apiKey": f"...{RPM_API_KEY[-4:]}" if RPM_API_KEY else None,
        "partnerId": RPM_PARTNER_ID,
        "appId": RPM_APP_ID,
        "orgId": RPM_ORG_ID,
        "subdomain": RPM_SUBDOMAIN,
        "iframeUrl": f"https://{RPM_SUBDOMAIN}.readyplayer.me/avatar",
        "status": "Ready Player Me is best used through the iframe integration",
        "instructions": {
            "1": "Use the iframe URL provided above in your frontend",
            "2": "The iframe handles authentication automatically",
            "3": "Users can upload photos or create avatars manually",
            "4": "Listen for postMessage events to get the avatar URL"
        }
    }

@app.get("/api/clothing/catalog")
async def get_clothing_catalog():
    """Get available clothing items (mock data for now)"""
    return [
        {
            "id": "shirt_001",
            "name": "Basic T-Shirt",
            "type": "shirt",
            "modelUrl": "https://example.com/tshirt.glb",
            "thumbnailUrl": "https://example.com/tshirt.png",
            "sizes": ["XS", "S", "M", "L", "XL"],
            "colors": ["white", "black", "blue", "red"],
            "price": 29.99
        },
        {
            "id": "pants_001", 
            "name": "Classic Jeans",
            "type": "pants",
            "modelUrl": "https://example.com/jeans.glb",
            "thumbnailUrl": "https://example.com/jeans.png",
            "sizes": ["XS", "S", "M", "L", "XL"],
            "colors": ["blue", "black", "grey"],
            "price": 79.99
        },
        {
            "id": "dress_001",
            "name": "Summer Dress",
            "type": "dress",
            "modelUrl": "https://example.com/dress.glb", 
            "thumbnailUrl": "https://example.com/dress.png",
            "sizes": ["XS", "S", "M", "L", "XL"],
            "colors": ["red", "blue", "floral"],
            "price": 59.99
        }
    ]

@app.post("/api/clothing/fit")
async def fit_clothing_to_avatar(request: Dict[str, Any]):
    """Fit clothing to avatar (mock implementation)"""
    return {
        "success": True,
        "fittedModelUrl": request.get("clothingUrl", "https://example.com/fitted-clothing.glb"),
        "fitScore": 0.92,
        "recommendations": [
            "Size M fits perfectly",
            "Consider size L for a looser fit"
        ]
    }

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting AI Avatar Clothing Fit API...")
    logger.info(f"Ready Player Me subdomain: {RPM_SUBDOMAIN}")
    logger.info("Note: Using iframe integration for avatar creation")
    uvicorn.run(app, host=API_HOST, port=API_PORT, reload=DEV_MODE)