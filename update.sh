#!/bin/bash
# Update script for NAS Deployment
# This pulls the latest code and automatically fixes file permissions 
# so Nginx (Docker) can read them without throwing 403 Forbidden errors.

echo "🔄 Pulling latest changes from Git..."
git pull origin main

echo "🔒 Fixing file permissions for Nginx..."
chmod 644 index.html favicon.ico 2>/dev/null
chmod -R 755 js css backend deployment 2>/dev/null

echo "✅ Update complete! Nginx can now serve the updated files."
