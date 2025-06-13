#!/usr/bin/env python3
"""
Single entry point for the AI Avatar Clothing Fit API
"""
import os
import sys
import uvicorn
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def main():
    """Start the main API server"""
    print("🚀 Starting AI Avatar Clothing Fit API...")
    print("=" * 50)
    
    # Check configuration
    api_key = os.getenv("READYME_API_KEY")
    partner_id = os.getenv("READYME_PARTNER_ID")
    
    if api_key and partner_id:
        print("✅ Ready Player Me configured")
        print(f"   Partner ID: {partner_id}")
        print(f"   Subdomain: {os.getenv('READYME_SUBDOMAIN')}")
    else:
        print("⚠️  Ready Player Me not fully configured")
        print("   Please check your .env file")
    
    print("=" * 50)
    
    # Import main app
    from main import app
    
    # Run server
    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("API_PORT", "8000"))
    
    print(f"🌐 Server starting at http://{host}:{port}")
    print(f"📚 API docs at http://{host}:{port}/docs")
    print(f"🔧 Interactive API at http://{host}:{port}/redoc")
    
    uvicorn.run(
        "main:app",  # Pass as string instead of object for reload to work
        host=host,
        port=port,
        reload=os.getenv("DEV_MODE", "true").lower() == "true",
        log_level=os.getenv("LOG_LEVEL", "INFO").lower()
    )

if __name__ == "__main__":
    main()