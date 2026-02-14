
import os
import io
import json
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

# Configuration
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# ID of VENTAS CC - AYLEN - ESW
SPREADSHEET_ID = '1O38MtmyuOmROpEGCuOQBfKdZ-qHJuojCirBPIpRS4Ec'
OUTPUT_FILE = os.path.join(SCRIPT_DIR, 'test_aylen.xlsx')
SERVICE_ACCOUNT_FILE = os.path.join(SCRIPT_DIR, 'google_credentials.json')

SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

def download_sheet():
    try:
        creds = service_account.Credentials.from_service_account_file(
            SERVICE_ACCOUNT_FILE, scopes=SCOPES)
        drive_service = build('drive', 'v3', credentials=creds)
        request = drive_service.files().export_media(
            fileId=SPREADSHEET_ID,
            mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        fh = io.BytesIO()
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while done is False:
            status, done = downloader.next_chunk()
        with open(OUTPUT_FILE, 'wb') as f:
            f.write(fh.getvalue())
        print(f"SUCCESS: Synced to '{OUTPUT_FILE}'")
    except Exception as e:
        print(f"SYNC ERROR: {e}")

if __name__ == '__main__':
    download_sheet()
