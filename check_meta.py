
import os
import json
from google.oauth2 import service_account
from googleapiclient.discovery import build

# Configuration
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SPREADSHEET_ID = '12ba_3FX1xK6d8UmzkeRBXhCVYXfi8plL-Uga5tXpajE'
SERVICE_ACCOUNT_FILE = os.path.join(SCRIPT_DIR, 'google_credentials.json')
SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

def check_file():
    creds = service_account.Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    service = build('drive', 'v3', credentials=creds)
    try:
        file_meta = service.files().get(fileId=SPREADSHEET_ID, fields='name, mimeType, capabilities').execute()
        print(f"File Metadata: {file_meta}")
    except Exception as e:
        print(f"Error checking file: {e}")

if __name__ == '__main__':
    check_file()
