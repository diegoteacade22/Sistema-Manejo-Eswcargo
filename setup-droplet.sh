# Este archivo no es necesario para servidores con Docker ya instalado
# Ver README.md para instrucciones de despliegue

set -e

echo "🚀 Iniciando configuración del servidor..."

# 1. Update system
echo "📦 Actualizando sistema..."
sudo apt-get update
sudo apt-get upgrade -y

# 2. Install Docker
echo "🐳 Instalando Docker..."
sudo apt-get install -y apt-transport-https ca-certificates curl software-properties-common
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io

# 3. Install Docker Compose
echo "🔧 Instalando Docker Compose..."
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 4. Add current user to docker group
echo "👤 Configurando permisos..."
sudo usermod -aG docker $USER

# 5. Install Git
echo "📚 Instalando Git..."
sudo apt-get install -y git

# 6. Install Nginx
echo "🌐 Instalando Nginx..."
sudo apt-get install -y nginx

# 7. Install Certbot for SSL
echo "🔒 Instalando Certbot (SSL)..."
sudo apt-get install -y certbot python3-certbot-nginx

# 8. Configure firewall
echo "🔥 Configurando firewall..."
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

# 9. Create application directory
echo "📁 Creando directorios de aplicación..."
sudo mkdir -p /var/www/eswcargo
sudo chown -R $USER:$USER /var/www/eswcargo

echo "✅ Configuración base completada!"
echo ""
echo "Próximos pasos:"
echo "1. Cierra esta sesión SSH y vuelve a entrar (para aplicar permisos de Docker)"
echo "2. Clona tu repositorio: cd /var/www/eswcargo && git clone https://github.com/diegoteacade22/Sistema-Manejo-Eswcargo.git"
echo "3. Ejecuta el script de despliegue"
