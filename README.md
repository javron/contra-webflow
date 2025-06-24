# Contra Webflow SDK

A professional-grade, attribute-driven SDK for integrating Contra experts and services into any Webflow project with zero-to-minimal code.

---

## 🚀 Quick Start with jsDelivr

To get started, add the following script tags to the `<head>` or before the closing `</body>` tag of your Webflow site.

### **1. CDN Script**

This script contains all the necessary logic to power the components. Use the versioned link for production to avoid breaking changes.

**Production (Recommended):**
```html
<script src="https://cdn.jsdelivr.net/gh/javron/contra-webflow@v1.0.0/dist/runtime.min.js"></script>
```

**Latest (Bleeding Edge):**
```html
<script src="https://cdn.jsdelivr.net/gh/javron/contra-webflow/dist/runtime.min.js"></script>
```

### **2. Configuration**

Add this `script` tag right after the CDN script to configure the SDK with your unique Program ID and API Key.

```html
<script id="contra-config" type="application/json">
{
  "apiKey": "csk_...",
  "programId": "your_program_id",
  "debug": false
}
</script>
```

### **3. Example: Displaying an Expert List**

Design your expert list in Webflow, then add `data-contra` attributes to connect the elements to the SDK.

1.  **Main Container**: Add `data-contra-program` to the parent element that will contain your expert list.
2.  **Template Element**: Create a single item inside the container to act as a template. Style it however you like, but hide it by default (`display: none`). Add the `data-contra-template` attribute to it.
3.  **Data Fields**: Inside your template, add `data-contra-field` attributes to bind text and image elements to expert data.

```html
<div data-contra-program="your_program_id">
  <!-- This is the template that will be cloned for each expert -->
  <div data-contra-template style="display: none;">
    <img data-contra-field="avatarUrl" alt="Expert Avatar" />
    <h3 data-contra-field="name"></h3>
    <p data-contra-field="location"></p>
    <p data-contra-field="oneLiner"></p>
    
    <!-- Projects -->
    <div data-contra-repeat="projects" data-contra-max="4">
      <a data-contra-field="projectUrl" href="#">
        <img data-contra-field="coverUrl" alt="Project Cover" />
        <div data-contra-field="title"></div>
      </a>
    </div>
  </div>
  
  <!-- (Optional) Loading State -->
  <div data-contra-loading style="display: none;">
    <h3>Loading experts, please wait...</h3>
  </div>
  
  <!-- (Optional) Empty State -->
  <div data-contra-empty style="display: none;">
    <h3>No experts match your criteria.</h3>
  </div>
</div>
```

---

## 📦 Package Architecture
This repository contains the standalone Webflow runtime package. It is built with TypeScript and bundled with `tsup` for maximum performance and compatibility.

```
/
├── dist/              # Compiled, minified, and production-ready JS files
├── src/               # Original TypeScript source code
├── simple-webflow-embed.html   # A minimal, clean example for Webflow
├── webflow-embed-example.html  # A more complex, styled example
└── README.md
```

---

## 🎨 **Advanced Webflow Features**

### **Data Binding Attributes**

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `data-contra-field="name"` | Bind expert data | `<h3 data-contra-field="name"></h3>` |
| `data-contra-format="rate"` | Format display | `<span data-contra-field="hourlyRateUSD" data-contra-format="rate"></span>` |
| `data-contra-stars` | Show star rating | `<div data-contra-stars></div>` |

### **Repeating Elements**

```html
<!-- Show up to 4 projects -->
<div data-contra-repeat="projects" data-contra-max="4">
  <div>
    <img data-contra-field="coverUrl">
    <h4 data-contra-field="title"></h4>
  </div>
</div>

<!-- Show skill tags -->
<div data-contra-repeat="skillTags" data-contra-max="5">
  <span data-contra-field="name"></span>
</div>
```

### **Smart Filtering**

```html
<!-- Dropdown filter -->
<select data-contra-filter="sortBy">
  <option value="relevance">Most Relevant</option>
  <option value="newest">Newest</option>
  <option value="rate_desc">Highest Rate</option>
</select>

<!-- Multi-select -->
<select data-contra-filter="languages" multiple>
  <option value="JavaScript">JavaScript</option>
  <option value="Python">Python</option>
  <option value="React">React</option>
</select>

<!-- Range slider -->
<input type="range" data-contra-filter="maxRate" min="0" max="300" step="25">

<!-- Search input -->
<input type="text" data-contra-filter="q" placeholder="Search experts...">
```

### **Conditional Display**

```html
<!-- Show only if hourly rate > 100 -->
<div data-contra-show-when="hourlyRateUSD:>:100">
  <span>Premium Expert</span>
</div>

<!-- Hide if not available -->
<div data-contra-hide-when="available:false">
  <button>Contact Now</button>
</div>
```

### **Pagination & Actions**

```html
<button data-contra-action="prev-page">Previous</button>
<button data-contra-action="next-page">Next</button>
<button data-contra-action="clear-filters">Clear All</button>
<div data-contra-pagination-info></div>
```

---

## 🎯 **Real-World Examples**

### **1. Expert Directory with Filters**
```html
<div data-contra-program="design-experts">
  <!-- Filters -->
  <div class="filters">
    <select data-contra-filter="location">
      <option value="">All Locations</option>
      <option value="United States">United States</option>
      <option value="Remote">Remote</option>
    </select>
    
    <input type="range" data-contra-filter="minRate" min="0" max="200">
    <span>Min Rate: $<span id="rate-display">0</span>/hr</span>
  </div>
  
  <!-- Expert Grid -->
  <div class="expert-grid">
    <div data-contra-template class="expert-card">
      <img data-contra-field="avatarUrl" class="avatar">
      <h3 data-contra-field="name"></h3>
      <p data-contra-field="oneLiner"></p>
      <div data-contra-field="hourlyRateUSD" data-contra-format="rate" class="rate"></div>
      <div data-contra-stars class="rating"></div>
      <a data-contra-field="inquiryUrl" class="cta-button">Contact Expert</a>
    </div>
  </div>
  
  <!-- States -->
  <div data-contra-loading>🔄 Loading amazing experts...</div>
  <div data-contra-error class="error-message"></div>
  <div data-contra-empty>No experts match your criteria.</div>
</div>
```

### **2. Featured Expert Showcase**
```html
<div data-contra-program="featured-experts" data-contra-limit="3">
  <div data-contra-template class="featured-expert">
    <div class="expert-hero">
      <img data-contra-field="avatarUrl">
      <div class="expert-info">
        <h2 data-contra-field="name"></h2>
        <p data-contra-field="oneLiner"></p>
        <div data-contra-stars></div>
        <div class="stats">
          <span data-contra-field="projectsCompletedCount" data-contra-format="number"></span> projects
          <span data-contra-field="reviewsCount" data-contra-format="number"></span> reviews
        </div>
      </div>
    </div>
    
    <div class="recent-projects" data-contra-repeat="projects" data-contra-max="3">
      <div class="project-card">
        <img data-contra-field="coverUrl">
        <h4 data-contra-field="title"></h4>
      </div>
    </div>
  </div>
</div>
```

---

## 🚀 **Performance Features**

- **🔄 Smart Caching** - API responses cached for 5-60 minutes
- **⚡ Request Deduplication** - Prevents duplicate API calls
- **🎯 Debounced Filtering** - Smooth user experience
- **📱 Lazy Loading** - Load experts as needed
- **🔧 Error Recovery** - Automatic retry with exponential backoff
- **📊 Performance Monitoring** - Built-in cache statistics

---

## 🛠️ **Development**

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Development mode
npm run dev
```

---

## 🏷️ **Versioning and Deployment**

This project uses Git tags for versioning, which are automatically picked up by jsDelivr. To release a new version:

1.  **Commit your changes**: Make sure all your latest changes are committed to the `main` branch.
    ```bash
    git commit -am "feat: Add new feature"
    git push origin main
    ```

2.  **Create a new tag**: Use semantic versioning (e.g., `v1.0.1`, `v1.1.0`).
    ```bash
    git tag v1.0.1 -m "Release v1.0.1"
    ```

3.  **Push the tag to GitHub**:
    ```bash
    git push --tags
    ```

4.  **Update your CDN link**: jsDelivr will now serve the new version. Simply update the version number in your script tag.
    ```html
    <!-- From: -->
    <script src="https://cdn.jsdelivr.net/gh/javron/contra-webflow@v1.0.0/dist/runtime.min.js"></script>

    <!-- To: -->
    <script src="https://cdn.jsdelivr.net/gh/javron/contra-webflow@v1.0.1/dist/runtime.min.js"></script>
    ```

---

## 📚 **API Reference**

### **ContraClient**
```typescript
const client = new ContraClient({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.contra.com',
  timeout: 10000,
  debug: false
})

// List experts with filters (using programNid from API)
const experts = await client.listExperts('program-nid', {
  available: true,
  minRate: 50,
  location: 'United States',
  sortBy: 'relevance'
})

// Get program details
const program = await client.getProgram('program-nid')

// Search experts (client-side filtering)
const results = await client.searchExperts('program-nid', 'React developer')

// Get available filters for this program
const filters = await client.getFilterOptions('program-nid')
```

---

## 🎨 **Styling Guide**

The SDK adds these CSS classes automatically:

```css
/* Runtime states */
.contra-runtime { /* Applied to containers */ }
.loading { /* During API calls */ }
.error { /* When errors occur */ }

/* Star ratings */
.star { /* All star elements */ }
.star-full { /* Filled stars */ }
.star-half { /* Half stars */ }
.star-empty { /* Empty stars */ }
```

---

## 🔗 **CDN URLs**

**Production (Recommended):**
```html
<script src="https://cdn.jsdelivr.net/gh/javron/contra-webflow@v1.0.0/dist/runtime.min.js"></script>
```

**Development:**
```html
<script src="https://cdn.jsdelivr.net/gh/javron/contra-webflow/dist/index.js"></script>
```

---

## 🤝 **Support**

- **📖 Documentation**: [Full API Docs](https://github.com/javron/contra-sdk)
- **💬 Issues**: [GitHub Issues](https://github.com/javron/contra-sdk/issues)
- **🚀 Examples**: [Live Demos](https://github.com/javron/contra-sdk/tree/main/examples)

---

## 📄 **License**

MIT License - feel free to use in commercial projects!

---

**Built with ❤️ for the Contra community**

## 🎯 **API Specification Compliance**

✅ **100% OpenAPI 3.0.3 Compliant** - Our SDK matches the exact Contra API specification:

### **Endpoints:**
- `GET /public-api/programs/{programNid}` - Program details
- `GET /public-api/programs/{programNid}/experts` - Expert listings with filters  
- `GET /public-api/programs/{programNid}/filters` - Available filter options

### **Query Parameters (Exact from API):**
- `available` - `"true"` or `"false"` (string enum)
- `languages` - Comma-separated: `"English,Spanish"` or array
- `location` - With Google Place ID: `"San Francisco CA, USA (ChIJIQBpAG2ahYAR_6128GcTUEo)"`
- `minRate` / `maxRate` - Numbers: `50`, `200`
- `sortBy` - `"relevance" | "oldest" | "newest"`
- `limit` / `offset` - Pagination: `20`, `0`

### **Data Types:**
All TypeScript interfaces generated directly from the OpenAPI schema ensure perfect compatibility.

--- 
