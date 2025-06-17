# backend/readyplayer_integration.py
"""
Ready Player Me Integration Module
This module handles the iframe-based integration with Ready Player Me
since direct API access requires enterprise partnership.
"""

import json
import logging
from typing import Dict, Optional, Tuple
import numpy as np
from datetime import datetime

logger = logging.getLogger(__name__)

class ReadyPlayerMeIntegration:
    """
    Ready Player Me integration using iframe approach
    Direct API access is limited without enterprise partnership
    """
    
    def __init__(self, subdomain: str = "styleit"):
        self.subdomain = subdomain
        self.base_url = f"https://{subdomain}.readyplayer.me"
        
    def get_iframe_config(self, options: Dict = None) -> Dict:
        """
        Get configuration for Ready Player Me iframe
        
        Args:
            options: Optional configuration like gender, bodyType, etc.
            
        Returns:
            Configuration dictionary for iframe setup
        """
        default_options = {
            "clearCache": "",
            "frameApi": "",
            "bodyType": "fullbody",
            "quickStart": "false",
            "gender": "neutral",
            "quality": "high",
            "meshLod": "1",  # 0 = highest, 2 = lowest
            "textureAtlas": "1024",  # texture resolution
            "morphTargets": "ARKit,Oculus Visemes",  # for animations
        }
        
        if options:
            default_options.update(options)
        
        # Build query string
        query_params = "&".join([f"{k}={v}" for k, v in default_options.items() if v])
        iframe_url = f"{self.base_url}/avatar?{query_params}"
        
        return {
            "iframeUrl": iframe_url,
            "subdomain": self.subdomain,
            "options": default_options,
            "eventHandlers": {
                "v1.frame.ready": "Iframe loaded and ready",
                "v1.avatar.exported": "Avatar created and exported",
                "v1.user.set": "User logged in",
                "v1.user.updated": "User updated",
                "v1.asset.select": "Asset selected",
                "v1.avatar.failed": "Avatar creation failed"
            }
        }
    
    def parse_avatar_url(self, avatar_url: str) -> Dict:
        """
        Parse Ready Player Me avatar URL to extract metadata
        
        Args:
            avatar_url: The GLB URL from Ready Player Me
            
        Returns:
            Dictionary with avatar metadata
        """
        if not avatar_url:
            return {}
        
        metadata = {
            "url": avatar_url,
            "format": "glb",
            "provider": "readyplayerme",
            "created_at": datetime.now().isoformat()
        }
        
        # Extract avatar ID from URL
        if "models.readyplayer.me" in avatar_url:
            try:
                # URL format: https://models.readyplayer.me/[avatar-id].glb
                avatar_id = avatar_url.split("/")[-1].replace(".glb", "")
                metadata["rpm_id"] = avatar_id
                
                # Generate additional URLs
                metadata["thumbnail_url"] = avatar_url.replace(".glb", ".png")
                metadata["render_url"] = f"https://render.readyplayer.me/render/{avatar_id}"
                
            except Exception as e:
                logger.error(f"Failed to parse avatar URL: {e}")
        
        return metadata
    
    def calculate_body_shape_from_measurements(self, measurements: Dict) -> Dict:
        """
        Calculate Ready Player Me compatible body shape from measurements
        
        Args:
            measurements: Dictionary with height, weight, chest, waist, hips
            
        Returns:
            Body shape parameters for Ready Player Me
        """
        # Calculate BMI
        height_m = measurements.get("height", 170) / 100
        weight = measurements.get("weight", 70)
        bmi = weight / (height_m ** 2)
        
        # Determine body type
        body_types = {
            "thin": {"bmi_range": (0, 18.5), "muscle": 0.0, "weight": -0.5},
            "athletic": {"bmi_range": (18.5, 22), "muscle": 0.5, "weight": 0.0},
            "average": {"bmi_range": (22, 25), "muscle": 0.2, "weight": 0.3},
            "muscular": {"bmi_range": (25, 28), "muscle": 0.8, "weight": 0.5},
            "heavy": {"bmi_range": (28, 100), "muscle": 0.1, "weight": 1.0}
        }
        
        selected_type = "average"
        for body_type, params in body_types.items():
            if params["bmi_range"][0] <= bmi < params["bmi_range"][1]:
                selected_type = body_type
                break
        
        # Calculate proportions
        chest = measurements.get("chest", 95)
        waist = measurements.get("waist", 80)
        hips = measurements.get("hips", 95)
        
        # Normalize measurements (Ready Player Me uses -1 to 1 scale)
        chest_ratio = (chest - 95) / 30  # Normalize around average
        waist_ratio = (waist - 80) / 25
        hip_ratio = (hips - 95) / 30
        
        return {
            "bodyType": selected_type,
            "morphTargets": {
                "weight": np.clip(body_types[selected_type]["weight"], -1, 1),
                "muscle": np.clip(body_types[selected_type]["muscle"], 0, 1),
                "chest": np.clip(chest_ratio, -1, 1),
                "waist": np.clip(waist_ratio, -1, 1),
                "hips": np.clip(hip_ratio, -1, 1),
                "height": height_m / 1.7  # Normalize to average height
            },
            "metadata": {
                "bmi": round(bmi, 2),
                "bodyType": selected_type,
                "measurements": measurements
            }
        }
    
    def generate_iframe_html(self, options: Dict = None) -> str:
        """
        Generate complete HTML code for embedding Ready Player Me iframe
        
        Args:
            options: Configuration options
            
        Returns:
            HTML string with iframe and event handling
        """
        config = self.get_iframe_config(options)
        
        html = f"""
<!DOCTYPE html>
<html>
<head>
    <title>Ready Player Me Avatar Creator</title>
    <style>
        body {{
            margin: 0;
            padding: 0;
            overflow: hidden;
            font-family: Arial, sans-serif;
        }}
        #rpm-container {{
            width: 100vw;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }}
        #rpm-iframe {{
            width: 100%;
            height: 100%;
            border: none;
        }}
        #status {{
            padding: 10px;
            background: #f0f0f0;
            text-align: center;
            display: none;
        }}
        .success {{ color: green; }}
        .error {{ color: red; }}
    </style>
</head>
<body>
    <div id="rpm-container">
        <div id="status"></div>
        <iframe
            id="rpm-iframe"
            src="{config['iframeUrl']}"
            allow="camera; microphone; clipboard-write"
            allowfullscreen
        ></iframe>
    </div>
    
    <script>
        // Configuration
        const subdomain = '{self.subdomain}';
        const validOrigins = [
            'https://' + subdomain + '.readyplayer.me',
            'https://readyplayer.me'
        ];
        
        // Status display
        function showStatus(message, type = 'info') {{
            const status = document.getElementById('status');
            status.textContent = message;
            status.className = type;
            status.style.display = 'block';
            
            if (type === 'success') {{
                setTimeout(() => {{
                    status.style.display = 'none';
                }}, 5000);
            }}
        }}
        
        // Message handler
        window.addEventListener('message', function(event) {{
            // Validate origin
            if (!validOrigins.includes(event.origin)) {{
                return;
            }}
            
            console.log('Ready Player Me event:', event.data);
            
            try {{
                // Parse message
                const message = typeof event.data === 'string' 
                    ? JSON.parse(event.data) 
                    : event.data;
                
                // Handle different event types
                switch (message.eventName) {{
                    case 'v1.frame.ready':
                        showStatus('Ready Player Me loaded successfully', 'success');
                        break;
                        
                    case 'v1.avatar.exported':
                        if (message.data && message.data.url) {{
                            showStatus('Avatar created! Saving...', 'success');
                            handleAvatarExport(message.data.url);
                        }}
                        break;
                        
                    case 'v1.user.set':
                        showStatus('User logged in', 'info');
                        break;
                        
                    case 'v1.avatar.failed':
                        showStatus('Avatar creation failed', 'error');
                        break;
                        
                    default:
                        console.log('Unhandled event:', message.eventName);
                }}
            }} catch (error) {{
                console.error('Error parsing message:', error);
                
                // Handle legacy format (direct URL string)
                if (typeof event.data === 'string' && event.data.includes('.glb')) {{
                    showStatus('Avatar created! Saving...', 'success');
                    handleAvatarExport(event.data);
                }}
            }}
        }});
        
        // Handle avatar export
        function handleAvatarExport(avatarUrl) {{
            console.log('Avatar URL:', avatarUrl);
            
            // Send to parent window if embedded
            if (window.parent !== window) {{
                window.parent.postMessage({{
                    type: 'avatar-created',
                    avatarUrl: avatarUrl,
                    timestamp: new Date().toISOString()
                }}, '*');
            }}
            
            // Or send to backend
            // fetch('/api/avatar/from-iframe', {{
            //     method: 'POST',
            //     headers: {{ 'Content-Type': 'application/json' }},
            //     body: JSON.stringify({{ avatarUrl: avatarUrl }})
            // }});
        }}
    </script>
</body>
</html>
"""
        return html
    
    def get_size_recommendation(self, measurements: Dict) -> str:
        """
        Get clothing size recommendation based on measurements
        
        Args:
            measurements: Body measurements
            
        Returns:
            Recommended size (XS, S, M, L, XL, XXL)
        """
        # Average the key measurements
        chest = measurements.get("chest", 95)
        waist = measurements.get("waist", 80)
        hips = measurements.get("hips", 95)
        
        avg = (chest + waist + hips) / 3
        
        # Size mapping
        if avg < 80:
            return "XS"
        elif avg < 87:
            return "S"
        elif avg < 95:
            return "M"
        elif avg < 105:
            return "L"
        elif avg < 115:
            return "XL"
        else:
            return "XXL"

# Example usage
def get_integration_example():
    """Get example code for using the integration"""
    return """
# Example: Setting up Ready Player Me integration

from readyplayer_integration import ReadyPlayerMeIntegration

# Initialize
rpm = ReadyPlayerMeIntegration(subdomain="styleit")

# Get iframe configuration
config = rpm.get_iframe_config({
    "gender": "female",
    "bodyType": "fullbody",
    "quality": "high"
})

# In your frontend, use the iframe URL:
iframe_url = config["iframeUrl"]

# Listen for messages from the iframe:
# When you receive the avatar URL, save it:
avatar_metadata = rpm.parse_avatar_url(avatar_url)

# Calculate body shape from measurements:
measurements = {
    "height": 170,
    "weight": 65,
    "chest": 90,
    "waist": 75,
    "hips": 95
}

body_shape = rpm.calculate_body_shape_from_measurements(measurements)
"""

if __name__ == "__main__":
    # Test the integration
    rpm = ReadyPlayerMeIntegration()
    config = rpm.get_iframe_config()
    print("Iframe configuration:", json.dumps(config, indent=2))
    
    # Test body shape calculation
    test_measurements = {
        "height": 175,
        "weight": 70,
        "chest": 95,
        "waist": 80,
        "hips": 95
    }
    body_shape = rpm.calculate_body_shape_from_measurements(test_measurements)
    print("\nBody shape:", json.dumps(body_shape, indent=2))