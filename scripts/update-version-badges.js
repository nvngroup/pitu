const fs = require('fs');
const path = require('path');

function updateVersionBadges() {
    // Get version from package.json
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const version = packageJson.version;
    
    console.log(`🔄 Updating version badges to ${version}...`);
    
    // Update README.md (Portuguese)
    const readmePath = path.join(__dirname, '..', 'README.md');
    let readmeContent = fs.readFileSync(readmePath, 'utf8');
    readmeContent = readmeContent.replace(
        /\[!\[Versão\]\(https:\/\/img\.shields\.io\/badge\/versão-[\d\.]+/g,
        `[![Versão](https://img.shields.io/badge/versão-${version}`
    );
    fs.writeFileSync(readmePath, readmeContent);
    console.log('✅ Updated README.md');
    
    // Update README-en.md (English)
    const readmeEnPath = path.join(__dirname, '..', 'README-en.md');
    let readmeEnContent = fs.readFileSync(readmeEnPath, 'utf8');
    readmeEnContent = readmeEnContent.replace(
        /\[!\[Versão\]\(https:\/\/img\.shields\.io\/badge\/versão-[\d\.]+/g,
        `[![Versão](https://img.shields.io/badge/versão-${version}`
    );
    fs.writeFileSync(readmeEnPath, readmeEnContent);
    console.log('✅ Updated README-en.md');
    
    console.log(`🎉 Version badges updated successfully to ${version}`);
}

// Run if called directly
if (require.main === module) {
    updateVersionBadges();
}

module.exports = updateVersionBadges;
