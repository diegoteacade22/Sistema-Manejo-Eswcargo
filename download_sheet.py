
import os
import io
import json
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

# Configuration
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SPREADSHEET_ID = '12ba_3FX1xK6d8UmzkeRBXhCVYXfi8plL-Uga5tXpajE'
OUTPUT_FILE = os.path.join(SCRIPT_DIR, 'VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx')
SERVICE_ACCOUNT_FILE = os.path.join(SCRIPT_DIR, 'google_credentials.json')

SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

def download_sheet():
    print("---------------------------------------------------")
    print("   AUTOSYNC: GOOGLE DRIVE -> EXCEL                 ")
    print("---------------------------------------------------")
    
    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        print(f"ERROR: Credentials file '{SERVICE_ACCOUNT_FILE}' not found.")
        return

    try:
        print("Authenticating with Google Cloud...")
        creds = service_account.Credentials.from_service_account_file(
            SERVICE_ACCOUNT_FILE, scopes=SCOPES)
        
        # We use Drive API to export the Sheet
        drive_service = build('drive', 'v3', credentials=creds)
        
        print(f"Requesting export for Sheet ID: {SPREADSHEET_ID}...")
        
        request = drive_service.files().export_media(
            fileId=SPREADSHEET_ID,
            mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        
        fh = io.FileIO(OUTPUT_FILE, 'wb')
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while done is False:
            status, done = downloader.next_chunk()
            if status:
                print(f"Downloading... {int(status.progress() * 100)}%")
            
        print(f"SUCCESS: Synced to '{OUTPUT_FILE}'")
        
    except Exception as e:
        print(f"SYNC ERROR: Could not download file.")
        print(f"Details: {e}")
        
        # Check for permission error
        error_str = str(e)
        if "403" in error_str or "404" in error_str:
            print("\n*** ACTION REQUIRED ***")
            print("The Service Account cannot access the Google Sheet.")
            try:
                with open(SERVICE_ACCOUNT_FILE) as f:
                    c = json.load(f)
                    email = c.get('client_email', 'UNKNOWN')
                    print(f"Please SHARE the Google Sheet with this email:\n")
                    print(f"   {email}")
                    print("\n(Click 'Share' in Google Sheets -> Add this email -> Editor/Viewer)")
            except: pass
        
        # Exit with error code to stop pipeline if needed? 
        # For now, we allow pipeline to continue with old file, or maybe stop?
        # User said "generate automation that exports... each time", implies dependency.
        # But if offline, maybe better to fail?
        # Let's return error code.
        exit(1)

if __name__ == '__main__':
    download_sheet()
