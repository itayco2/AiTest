# backend/readyplayer_integration.py
import httpx
import json
import base64
from typing import Dict, Optional, Tuple
import numpy as np
from PIL import Image
import io
import logging

logger = logging.getLogger(__name__)

class ReadyPlayerMeIntegration:
    """Enhanced Ready Player Me integration with body morphing"""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.readyplayer.me/v2"
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
    async def create_avatar_from_measurements(
        self, 
        measurements: Dict,
        face_photo: Optional[bytes] = None
    ) -> Dict:
        """Create a Ready Player Me avatar with custom body shape"""
        
        try:
            # Calculate body morphing parameters from measurements
            morph_params = self._calculate_morph_parameters(measurements)
            
            # Step 1: Create base avatar with body type
            avatar_data = {
                "bodyType": morph_params["bodyType"],
                "gender": measurements.get("gender", "neutral"),
                "assets": {
                    "outfit": "casual",  # Default outfit
                    "hairStyle": "short",
                    "skinTone": "medium"
                }
            }
            
            async with httpx.AsyncClient() as client:
                # Create avatar
                response = await client.post(
                    f"{self.base_url}/avatars",
                    headers=self.headers,
                    json=avatar_data
                )
                
                if response.status_code != 201:
                    logger.error(f"Failed to create avatar: {response.text}")
                    return None
                
                avatar_result = response.json()
                avatar_id = avatar_result["id"]
                
                # Step 2: Apply body morphing
                morph_response = await client.put(
                    f"{self.base_url}/avatars/{avatar_id}/morphing",
                    headers=self.headers,
                    json={
                        "morphTargets": morph_params["morphTargets"]
                    }
                )
                
                if morph_response.status_code != 200:
                    logger.warning("Failed to apply morphing, continuing with base avatar")
                
                # Step 3: Apply face photo if provided
                if face_photo:
                    face_result = await self._apply_face_photo(
                        client, avatar_id, face_photo
                    )
                    if face_result:
                        avatar_result.update(face_result)
                
                # Step 4: Generate final avatar with all modifications
                final_response = await client.post(
                    f"{self.base_url}/avatars/{avatar_id}/generate",
                    headers=self.headers,
                    json={
                        "format": "glb",
                        "lod": 1,  # Level of detail (0=highest, 2=lowest)
                        "textureAtlas": True,
                        "morphTargets": {
                            "oculus": ["visemes", "arkit"],
                            "arkit": ["51"]
                        }
                    }
                )
                
                if final_response.status_code == 200:
                    generation_result = final_response.json()
                    
                    return {
                        "avatarId": avatar_id,
                        "avatarUrl": generation_result["glb"],
                        "thumbnailUrl": generation_result["thumbnail"],
                        "metadata": {
                            "measurements": measurements,
                            "morphParameters": morph_params,
                            "provider": "readyplayerme",
                            "hasFacePhoto": face_photo is not None
                        }
                    }
                
        except Exception as e:
            logger.error(f"Ready Player Me integration error: {e}")
            return None
    
    def _calculate_morph_parameters(self, measurements: Dict) -> Dict:
        """Calculate Ready Player Me morph targets from measurements"""
        
        # Calculate BMI
        height_m = measurements["height"] / 100
        bmi = measurements["weight"] / (height_m ** 2)
        
        # Determine body type
        if bmi < 18.5:
            body_type = "skinny"
            weight_factor = 0.0
        elif bmi < 25:
            body_type = "athletic"
            weight_factor = 0.3
        elif bmi < 30:
            body_type = "average"
            weight_factor = 0.6
        else:
            body_type = "heavy"
            weight_factor = 1.0
        
        # Calculate individual morph targets
        # Ready Player Me uses values between -1 and 1 for most morphs
        morphs = {}
        
        # Chest/Bust morph
        chest_baseline = 95 if measurements.get("gender") == "male" else 90
        chest_diff = (measurements["chest"] - chest_baseline) / chest_baseline
        morphs["chest"] = np.clip(chest_diff * 2, -1, 1)
        
        # Waist morph
        waist_baseline = 80
        waist_diff = (measurements["waist"] - waist_baseline) / waist_baseline
        morphs["waist"] = np.clip(waist_diff * 2, -1, 1)
        
        # Hip morph
        hip_baseline = 95
        hip_diff = (measurements["hips"] - hip_baseline) / hip_baseline
        morphs["hips"] = np.clip(hip_diff * 2, -1, 1)
        
        # Overall weight/muscle morphs
        morphs["weight"] = weight_factor
        morphs["muscle"] = 0.2 if body_type == "athletic" else 0.0
        
        # Height adjustment (Ready Player Me uses scale)
        height_scale = measurements["height"] / 170  # 170cm as baseline
        
        # Additional measurements if available
        if measurements.get("neck"):
            neck_baseline = 38
            neck_diff = (measurements["neck"] - neck_baseline) / neck_baseline
            morphs["neck"] = np.clip(neck_diff * 2, -1, 1)
        
        if measurements.get("shoulders"):
            shoulder_baseline = 45
            shoulder_diff = (measurements["shoulders"] - shoulder_baseline) / shoulder_baseline
            morphs["shoulders"] = np.clip(shoulder_diff * 2, -1, 1)
        
        return {
            "bodyType": body_type,
            "heightScale": height_scale,
            "morphTargets": morphs
        }
    
    async def _apply_face_photo(
        self, 
        client: httpx.AsyncClient,
        avatar_id: str,
        face_photo: bytes
    ) -> Optional[Dict]:
        """Apply face photo to avatar using Ready Player Me face detection"""
        
        try:
            # Prepare the photo for upload
            image = Image.open(io.BytesIO(face_photo))
            
            # Resize if too large (max 2048x2048)
            max_size = 2048
            if image.width > max_size or image.height > max_size:
                image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
            
            # Convert to JPEG if not already
            output = io.BytesIO()
            if image.mode in ('RGBA', 'LA'):
                # Convert RGBA to RGB
                rgb_image = Image.new('RGB', image.size, (255, 255, 255))
                rgb_image.paste(image, mask=image.split()[-1] if image.mode == 'RGBA' else None)
                image = rgb_image
            
            image.save(output, format='JPEG', quality=95)
            photo_data = output.getvalue()
            
            # Upload photo for face detection
            files = {"photo": ("face.jpg", photo_data, "image/jpeg")}
            
            response = await client.post(
                f"{self.base_url}/avatars/{avatar_id}/face",
                headers={"Authorization": f"Bearer {self.api_key}"},
                files=files
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                logger.error(f"Face photo upload failed: {response.text}")
                return None
                
        except Exception as e:
            logger.error(f"Face photo processing error: {e}")
            return None
    
    async def update_avatar_outfit(
        self,
        avatar_id: str,
        outfit_config: Dict
    ) -> Optional[Dict]:
        """Update avatar outfit/clothing"""
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.put(
                    f"{self.base_url}/avatars/{avatar_id}/outfit",
                    headers=self.headers,
                    json=outfit_config
                )
                
                if response.status_code == 200:
                    return response.json()
                else:
                    logger.error(f"Outfit update failed: {response.text}")
                    return None
                    
        except Exception as e:
            logger.error(f"Outfit update error: {e}")
            return None
    
    async def get_available_assets(self, asset_type: str = "outfit") -> list:
        """Get available assets (outfits, hair styles, etc.)"""
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/assets/{asset_type}",
                    headers=self.headers
                )
                
                if response.status_code == 200:
                    return response.json()["assets"]
                else:
                    return []
                    
        except Exception as e:
            logger.error(f"Failed to get assets: {e}")
            return []

# Utility functions for measurement conversion
def convert_us_to_metric(measurements: Dict) -> Dict:
    """Convert US measurements to metric"""
    conversions = {
        "height": lambda inches: inches * 2.54,  # inches to cm
        "weight": lambda lbs: lbs * 0.453592,    # lbs to kg
        "chest": lambda inches: inches * 2.54,
        "waist": lambda inches: inches * 2.54,
        "hips": lambda inches: inches * 2.54,
        "neck": lambda inches: inches * 2.54,
        "shoulders": lambda inches: inches * 2.54,
        "armLength": lambda inches: inches * 2.54,
        "legLength": lambda inches: inches * 2.54
    }
    
    metric_measurements = {}
    for key, value in measurements.items():
        if key in conversions and value is not None:
            metric_measurements[key] = conversions[key](value)
        else:
            metric_measurements[key] = value
    
    return metric_measurements

def calculate_size_recommendation(measurements: Dict) -> str:
    """Calculate recommended clothing size based on measurements"""
    
    # Average the key measurements
    key_measurements = []
    if "chest" in measurements:
        key_measurements.append(measurements["chest"])
    if "waist" in measurements:
        key_measurements.append(measurements["waist"])
    if "hips" in measurements:
        key_measurements.append(measurements["hips"])
    
    if not key_measurements:
        return "M"
    
    avg = sum(key_measurements) / len(key_measurements)
    
    # Size mapping (in cm)
    if avg < 85:
        return "XS"
    elif avg < 92:
        return "S"
    elif avg < 100:
        return "M"
    elif avg < 110:
        return "L"
    elif avg < 120:
        return "XL"
    else:
        return "XXL"