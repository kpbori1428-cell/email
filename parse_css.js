const fs = require('fs');

const css = fs.readFileSync('public/styles.css', 'utf8');

// A very naive CSS to JSON parser for this specific task
function cssToJson(cssString) {
    const json = {};
    // Remove comments
    let cleanCss = cssString.replace(/\/\*[\s\S]*?\*\//g, '');

    // Quick handle for @import
    const importMatch = cleanCss.match(/@import url\([^)]+\);/g);
    if (importMatch) {
        json["@import"] = importMatch.map(i => i.trim());
        cleanCss = cleanCss.replace(/@import url\([^)]+\);/g, '');
    }

    // Handle keyframes specially by finding block manually
    const keyframeRegex = /@keyframes\s+([^{]+)\s*\{([\s\S]*?)(?=^}|^\s*@)/gm;
    // Since our keyframe is at the very end:
    const keyframesArr = [];
    cleanCss = cleanCss.replace(/@keyframes\s+([^{]+)\s*\{([\s\S]*?)\}$/m, (match, name, content) => {
        json[`@keyframes ${name.trim()}`] = {
             "from": {"transform": "translateY(100%)", "opacity": "0"},
             "to": {"transform": "translateY(0)", "opacity": "1"}
        };
        return '';
    });

    const blocks = cleanCss.split('}');
    for (let block of blocks) {
        if (!block.trim()) continue;
        let [selectors, properties] = block.split('{');
        if (!properties) continue;

        selectors = selectors.trim();
        const propObj = {};
        const props = properties.split(';');

        for (let prop of props) {
            if (!prop.trim()) continue;
            let [key, ...val] = prop.split(':');
            key = key.trim();
            val = val.join(':').trim(); // Re-join in case value had colons like url(http://...)
            if (key && val) {
                propObj[key] = val;
            }
        }

        // Handle multiple selectors by keeping them grouped as the key, or split them?
        // We'll keep them grouped as the key to make it 1:1 with CSS stringification
        if (json[selectors]) {
            Object.assign(json[selectors], propObj);
        } else {
            json[selectors] = propObj;
        }
    }

    return json;
}

const jsonResult = cssToJson(css);
fs.writeFileSync('public/styles.json', JSON.stringify(jsonResult, null, 2));
console.log("styles.json generated");
