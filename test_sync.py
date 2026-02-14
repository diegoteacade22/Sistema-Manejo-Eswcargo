
import os
import io
import json
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

# Configuration
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# NEW ID found in .gsheet file
SPREADSHEET_ID = '1UcDTpB3gHpu5xVBdpKUK5_VCG0DmJdyD4SkCCEaXYdM'
OUTPUT_FILE = os.path.join(SCRIPT_DIR, 'test_new_id.xlsx')
SERVICE_ACCOUNT_FILE = os.path.join(SCRIPT_DIR, 'google_credentials.json')

SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

def download_sheet():
    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        print(f"ERROR: Credentials file '{SERVICE_ACCOUNT_FILE}' not found.")
        return

    try:
        print(f"Authenticating for ID: {SPREADSHEET_ID}...")
        creds = service_account.Credentials.from_service_account_file(
            SERVICE_ACCOUNT_FILE, scopes=SCOPES)
        drive_service = build('drive', 'v3', credentials=creds)
        
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
        print(f"SYNC ERROR: {e}")

if __name__ == '__main__':
    download_sheet()
