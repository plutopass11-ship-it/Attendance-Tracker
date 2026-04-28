const fs = require('fs');
const path = require('path');

// Manually read .env for Kitsu credentials
const envPath = path.join(__dirname, '../deployment/.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length > 0) {
    env[key.trim()] = valueParts.join('=').trim().replace(/\r/g, '');
  }
});

async function checkKitsuFields() {
  const kitsuUrl = 'http://192.168.1.60:80'; 
  try {
    console.log(`Logging into Kitsu at ${kitsuUrl}...`);
    const loginRes = await fetch(`${kitsuUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: env.KITSU_ADMIN_EMAIL,
        password: env.KITSU_ADMIN_PASSWORD
      })
    });

    if (!loginRes.ok) throw new Error('Login failed');
    const { access_token } = await loginRes.json();

    console.log('Fetching personal data for Joel...');
    const personRes = await fetch(`${env.KITSU_URL}/api/data/persons`, {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });

    if (!personRes.ok) throw new Error('Failed to fetch persons');
    const persons = await personRes.json();
    
    // Find Joel or first person
    const sample = persons.find(p => p.email === 'joyel@flyingpluto.ai') || persons[0];
    
    console.log('\n--- RAW KITSU PERSON DATA ---');
    console.log(JSON.stringify(sample, null, 2));
    
    const hasSlack = Object.keys(sample).some(key => key.toLowerCase().includes('slack'));
    console.log(`\nDoes it have any Slack-related fields? ${hasSlack ? 'YES' : 'NO'}`);

  } catch (err) {
    console.error('Error:', err.message);
  }
}

checkKitsuFields();
