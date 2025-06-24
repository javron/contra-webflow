import { ContraClient, utils } from '@contra/client';
import type {
  ExpertProfile,
  ExpertFilters,
  FilterChangeEvent,
  ExpertLoadEvent,
  ErrorEvent,
  ExpertField
} from '@contra/types';

/**
 * Webflow Runtime for Contra Experts
 * Simplified for flexibility and predictability.
 */

// Simplified configuration
interface RuntimeConfig {
  apiKey: string;
  debug?: boolean;
  loadingClass?: string;
  errorClass?: string;
  emptyClass?: string;
  // Video configuration
  videoAutoplay?: boolean;
  videoHoverPlay?: boolean;
  videoMuted?: boolean;
  videoLoop?: boolean;
  videoControls?: boolean;
  // Cloudinary transformations
  imageTransformations?: string;
  videoTransformations?: string;
  optimizeGifsAsVideo?: boolean;
  contraAnalytics?: boolean;
}

const CLOUDINARY_TRANSFORM_PREFIXES = [
  'w_', 'h_', 'c_', 'f_', 'q_', 'fl_', 'vc_', 'b_', 'e_', 'o_', 'a_', 'dpr_', 'ar_'
];

// Attribute constants
const ATTR_PREFIX = 'data-contra-';
const ATTRS = {
  // Core list attributes
  listId: 'list-id',
  program: 'program',
  template: 'template',
  
  // States
  loading: 'loading',
  error: 'error',
  empty: 'empty',
  
  // Field binding
  field: 'field',
  format: 'format',
  
  // Repeating elements
  repeat: 'repeat',
  max: 'max',
  
  // Sorting and pagination
  limit: 'limit',
  
  // Actions
  action: 'action',
  listTarget: 'list-target',

  // Conditional display
  showWhen: 'show-when',
  hideWhen: 'hide-when',
  prerenderPlaceholders: 'prerender-placeholders'
} as const;

// State management is now keyed by the list's unique ID
class RuntimeState {
  private states = new Map<string, {
    filters: ExpertFilters;
    experts: ExpertProfile[];
    loading: boolean;
    error: Error | null;
    offset: number;
    limit: number;
    totalCount: number;
    hasNextPage: boolean;
  }>();

  getState(listId: string) {
    if (!this.states.has(listId)) {
      this.states.set(listId, {
        filters: {},
        experts: [],
        loading: false,
        error: null,
        offset: 0,
        limit: 20, // Default limit
        totalCount: 0,
        hasNextPage: false
      });
    }
    return this.states.get(listId)!;
  }

  updateState(listId: string, updates: Partial<ReturnType<RuntimeState['getState']>>) {
    const state = this.getState(listId);
    Object.assign(state, updates);
    this.states.set(listId, state);
  }
}

/**
 * Main Runtime Class
 */
export class ContraWebflowRuntime {
  private client: ContraClient;
  private config: Required<RuntimeConfig>;
  private state = new RuntimeState();
  private debouncedReload: Map<string, () => void> = new Map();
  private filterNameMap: Record<string, string> = {
    locations: 'location',
  };
  private filterOptionLabels: Record<string, Record<string, string>> = {
    sortBy: {
      relevance: 'Relevance',
      oldest: 'Oldest',
      newest: 'Newest',
      rate_asc: 'Rate (Low to High)',
      rate_desc: 'Rate (High to Low)'
    }
  };

  constructor(config: RuntimeConfig) {
    this.config = {
      debug: false,
      loadingClass: 'loading',
      errorClass: 'error',
      emptyClass: 'empty',
      // Video configuration defaults
      videoAutoplay: false,
      videoHoverPlay: true,
      videoMuted: true,
      videoLoop: true,
      videoControls: false,
      // Cloudinary transformation defaults
      imageTransformations: 'f_auto,q_auto:eco,c_limit,w_800',
      videoTransformations: 'fl_progressive,f_auto,q_auto:eco,vc_auto,c_limit,h_720',
      optimizeGifsAsVideo: true,
      contraAnalytics: true,
      ...config
    };

    this.client = new ContraClient({
      apiKey: this.config.apiKey,
      debug: this.config.debug
    });

    this.log('Runtime initialized', this.config);
  }

  /**
   * Initialize the runtime by finding and setting up all lists.
   */
  async init(): Promise<void> {
    this.log('Initializing runtime...');

    try {
      // 1. Discover all lists and unique programs to fetch filters for
      const listElements = this.querySelectorAll(document.body, `[${ATTR_PREFIX}${ATTRS.listId}]`);
      this.log(`Found ${listElements.length} lists to initialize.`);
      
      const programFilters = new Map<string, any[]>();
      for (const listElement of listElements) {
        const programId = this.getAttr(listElement, ATTRS.program);
        if (programId && !programFilters.has(programId)) {
          this.log(`Fetching filters for program: ${programId}`);
          programFilters.set(programId, await this.getAvailableFilters(programId));
        }
      }

      // 2. Populate all filter controls on the page once
      this.populateAllFilterControls(programFilters);

      // 3. Initialize each list
      for (const listElement of listElements) {
        await this.initList(listElement);
      }

      // 4. Wire up all action buttons and filter controls
      this.wireActionButtons();
      this.wireFilterControls();

      this.log('Runtime initialization complete');
    } catch (error) {
      this.log('Runtime initialization failed', error);
      throw error;
    }
  }

  /**
   * Initialize a single expert list.
   */
  private async initList(listElement: Element): Promise<void> {
    const listId = this.getAttr(listElement, ATTRS.listId);
    const programId = this.getAttr(listElement, ATTRS.program);

    if (!listId || !programId) {
      this.log('List element is missing required attributes `data-contra-list-id` or `data-contra-program`.', listElement);
      return;
    }

    this.log(`Initializing list: ${listId} for program: ${programId}`);

    try {
      (listElement as HTMLElement).setAttribute('data-contra-initialized', 'true');
      (listElement as HTMLElement).classList.add('contra-list');
      
      const limit = parseInt(this.getAttr(listElement, ATTRS.limit) || '20', 10);
      const template = this.querySelector(listElement, `[${ATTR_PREFIX}${ATTRS.template}]`);

      // Prerender placeholders if requested, before the original template is hidden
      if (template && listElement.hasAttribute(`${ATTR_PREFIX}${ATTRS.prerenderPlaceholders}`)) {
        this.log(`Prerendering ${limit} placeholders for list: ${listId}`);
        for (let i = 0; i < limit; i++) {
          const placeholder = template.cloneNode(true) as Element;
          placeholder.removeAttribute(`${ATTR_PREFIX}${ATTRS.template}`);
          placeholder.classList.add('contra-placeholder-item');
          (placeholder as HTMLElement).style.display = ''; // Ensure placeholder is visible
          listElement.appendChild(placeholder);
        }
      }
      
      if (template) {
          (template as HTMLElement).style.display = 'none';
          this.log(`Template found and hidden for list: ${listId}`);
      }
      
      // Defensively remove inline display styles from state elements to prevent conflicts.
      const loadingEl = this.querySelector(listElement, `[${ATTR_PREFIX}${ATTRS.loading}]`);
      if (loadingEl) (loadingEl as HTMLElement).style.removeProperty('display');
      const emptyEl = this.querySelector(listElement, `[${ATTR_PREFIX}${ATTRS.empty}]`);
      if (emptyEl) (emptyEl as HTMLElement).style.removeProperty('display');

      const initialFilters = this.parseFiltersFromElement(listElement);
      
      this.state.updateState(listId, { 
      filters: initialFilters,
        limit: limit,
        offset: initialFilters.offset || 0,
      });
      
      this.state.updateState(listId, { loading: true, error: null });
      this.showLoading(listElement, true);

      const response = await this.client.listExperts(programId, initialFilters);
      
      this.log(`Loaded ${response.data.length} experts for list ${listId}`, response);

      const newExperts = response.data;
      const allExperts = newExperts;

      // Update state before touching the DOM
      this.state.updateState(listId, {
        experts: allExperts,
        totalCount: response.totalCount,
        offset: initialFilters.offset || 0 + newExperts.length,
        hasNextPage: newExperts.length === limit,
        loading: false
      });

      // Render experts and then immediately update all UI states
      this.renderExperts(listElement, newExperts, false);
      this.updateUIStates(listElement, listId);

    } catch (error) {
      this.log(`Failed to initialize list ${listId}`, error);
      this.state.updateState(listId, { loading: false, error: error as Error });
      this.showError(listElement, error as Error);
    } finally {
      this.showLoading(listElement, false);
    }
  }

  /**
   * Wire up all action buttons on the page.
   */
  private wireActionButtons(): void {
    const actionButtons = this.querySelectorAll(document.body, `[${ATTR_PREFIX}${ATTRS.action}]`);
    
    actionButtons.forEach(button => {
      const action = this.getAttr(button, ATTRS.action);
      const targetListId = this.getAttr(button, ATTRS.listTarget);
      
      if (!action || !targetListId) {
        this.log('Action button is missing required `data-contra-action` or `data-contra-list-target` attributes.', button);
        return;
      }

      button.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleAction(action, targetListId, button);
      });
    });
  }

  /**
   * Load experts for a given list.
   */
  private async loadExperts(listId: string, programId: string, append = false): Promise<void> {
    const listElement = this.querySelector(document.body, `[${ATTR_PREFIX}${ATTRS.listId}="${listId}"]`);
    if (!listElement) {
      this.log(`Cannot find list element with ID: ${listId}`);
          return;
        }

    // When reloading the list (not appending), we must hide the empty state message first.
    const emptyElement = this.querySelector(listElement, `[${ATTR_PREFIX}${ATTRS.empty}]`);
    if (!append && emptyElement) {
        (emptyElement as HTMLElement).style.display = 'none';
    }

    const state = this.state.getState(listId);
    const filters = {
      ...state.filters,
      limit: state.limit,
      offset: state.offset,
    };
    
    this.log(`Loading experts for list: ${listId}`, filters);

    try {
      this.showLoading(listElement, true);
      this.state.updateState(listId, { loading: true, error: null });

      const response = await this.client.listExperts(programId, filters);
      
      this.log(`Loaded ${response.data.length} experts for list ${listId}`, response);

      const newExperts = response.data;
      const allExperts = append ? [...state.experts, ...newExperts] : newExperts;

      // Update state before touching the DOM
      this.state.updateState(listId, {
        experts: allExperts,
        totalCount: response.totalCount,
        offset: state.offset + newExperts.length,
        hasNextPage: newExperts.length === state.limit,
        loading: false
      });

      // Render experts and then immediately update all UI states
      this.renderExperts(listElement, newExperts, append);
      this.updateUIStates(listElement, listId);

    } catch (error) {
      this.log(`Failed to load experts for list: ${listId}`, error);
      this.state.updateState(listId, { loading: false, error: error as Error });
      this.showError(listElement, error as Error);
    } finally {
      // Always ensure loading state is removed
      this.showLoading(listElement, false);
    }
  }

  /**
   * Render experts into the container. Can clear or append.
   */
  private renderExperts(listElement: Element, experts: ExpertProfile[], append: boolean): void {
    const template = this.querySelector(listElement, `[${ATTR_PREFIX}${ATTRS.template}]`);
    if (!template) {
      this.log('No template found in list', listElement);
      return;
    }
    const listId = this.getAttr(listElement, ATTRS.listId)!;

    // Handle prerendered placeholders on initial load
    const placeholders = this.querySelectorAll(listElement, '.contra-placeholder-item');
    if (!append && placeholders.length > 0) {
      this.log(`Populating ${experts.length} of ${placeholders.length} placeholders for list.`);
      
      experts.forEach((expert, i) => {
        const placeholder = placeholders[i];
        if (placeholder) {
          this._configureCard(placeholder, expert, listId);
          placeholder.classList.remove('contra-placeholder-item');
        }
      });

      // Remove any unused placeholders
      if (experts.length < placeholders.length) {
        this.log(`Removing ${placeholders.length - experts.length} unused placeholders.`);
        for (let i = experts.length; i < placeholders.length; i++) {
          placeholders[i].remove();
        }
      }
      this.log(`Finished rendering placeholders for list`, listElement);
      return; // Skip the standard rendering path
    }

    if (!append) {
      // Clear only previously rendered expert cards
      const existingCards = this.querySelectorAll(listElement, '.contra-rendered-item');
    existingCards.forEach(card => card.remove());
    }

    const fragment = document.createDocumentFragment();
    experts.forEach(expert => {
      const expertCard = this.populateExpertCard(template, expert, listId);
      fragment.appendChild(expertCard);
    });
    listElement.appendChild(fragment);

    this.log(`Rendered ${experts.length} expert cards into list`, listElement);
  }

  /**
   * Populate expert card from template
   */
  private populateExpertCard(template: Element, expert: ExpertProfile, listId: string): Element {
    const card = template.cloneNode(true) as Element;
    this._configureCard(card, expert, listId);
    return card;
  }

  /**
   * Configures an existing card element with expert data, including all sub-fields and repeaters.
   * This is the core rendering logic for a single item.
   */
  private _configureCard(card: Element, expert: ExpertProfile, listId: string): void {
    // Add a marker class to identify this as a rendered card
    card.classList.add('contra-rendered-item');
    
    // Remove template attribute and show the card
    card.removeAttribute(`${ATTR_PREFIX}${ATTRS.template}`);
    (card as HTMLElement).style.display = '';

    // --- Fix for repeater template pollution ---
    // 1. Temporarily detach repeater templates
    const repeatContainers = this.querySelectorAll(card, `[${ATTR_PREFIX}${ATTRS.repeat}]`);
    const detachedTemplates = new Map<Element, DocumentFragment>();
    repeatContainers.forEach(container => {
        const fragment = document.createDocumentFragment();
        while (container.firstChild) {
            fragment.appendChild(container.firstChild);
        }
        detachedTemplates.set(container, fragment);
    });

    // 2. Populate fields on the main card (now safely without repeater templates)
    this.populateFields(card, expert, listId);
    
    // 3. Re-attach the pristine templates
    detachedTemplates.forEach((fragment, container) => {
        container.appendChild(fragment);
    });

    // 4. Handle repeating elements, which will now use the clean templates
    this.populateRepeatingElements(card, expert, listId);
    
    // Handle conditional display
    this.handleConditionalDisplay(card, expert);
  }

  /**
   * Populate data fields in the card
   */
  private populateFields(card: Element, expert: ExpertProfile, listId: string): void {
    const fieldElements = this.querySelectorAll(card, `[${ATTR_PREFIX}${ATTRS.field}]`);
    
    fieldElements.forEach(element => {
      const fieldName = this.getAttr(element, ATTRS.field) as ExpertField;
      const format = this.getAttr(element, ATTRS.format);
      
      if (!fieldName || !(fieldName in expert)) return;

      const value = expert[fieldName];
      this.setElementValue(element, value, format, listId);
    });

    // Handle star ratings
    const starsElements = this.querySelectorAll(card, '[data-contra-stars]');
    starsElements.forEach(element => {
      if (expert.averageReviewScore) {
        this.renderStarRating(element, expert.averageReviewScore);
      }
    });
  }

  /**
   * Set element value with proper formatting
   */
  private setElementValue(element: Element, value: any, format?: string | null, listId?: string): void {
    if (value == null || value === '') return;

    // Media type detection and handling
    if (this.isMediaField(element) && typeof value === 'string' && value.trim()) {
      this.setMediaValue(element, value);
      return;
    }

    if (element instanceof HTMLAnchorElement) {
      let href = String(value);
      if (listId) {
          href = this._appendContraAnalytics(href, listId);
      }
      element.href = href;
      if (element.children.length === 0 && !element.textContent?.trim()) {
        element.textContent = String(value);
      }
    } else if (element instanceof HTMLInputElement) {
      element.value = String(value);
    } else if (element instanceof HTMLImageElement) {
      // Regular image handling for avatars and other images
      const mediaType = this.detectMediaType(String(value));
      const transformedUrl = this.transformMediaUrl(String(value), mediaType);
      element.src = transformedUrl;
      element.alt = element.alt || 'Image';
    } else {
      // Text content with formatting
      let displayValue = String(value);
      
      if (format) {
        switch (format) {
          case 'currency':
            displayValue = typeof value === 'number' ? `$${value}` : displayValue;
            break;
          case 'rate':
            displayValue = utils.formatRate(typeof value === 'number' ? value : null);
            break;
          case 'rating':
            // Format rating to one decimal place (5.0, 4.9, etc.)
            displayValue = typeof value === 'number' ? value.toFixed(1) : displayValue;
            break;
          case 'earnings':
            // Format earnings like $25k+
            if (typeof value === 'number') {
              if (value >= 1000000) {
                displayValue = `$${Math.floor(value / 1000000)}M+`;
              } else if (value >= 1000) {
                displayValue = `$${Math.floor(value / 1000)}k+`;
              } else {
                displayValue = `$${value}`;
              }
            }
            break;
          case 'number':
            displayValue = typeof value === 'number' ? value.toLocaleString() : displayValue;
            break;
          case 'truncate':
            displayValue = displayValue.length > 100 ? displayValue.substring(0, 97) + '...' : displayValue;
            break;
          case 'boolean':
            displayValue = value ? 'Yes' : 'No';
            break;
          case 'availability':
            displayValue = value ? 'Available' : 'Not Available';
            break;
        }
      }
      
      element.textContent = displayValue;
    }
  }

  /**
   * Star rating rendering with optional text display
   */
  private renderStarRating(element: Element, rating: number): void {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
    
    let starsHtml = '';
    
    // Full stars
    for (let i = 0; i < fullStars; i++) {
      starsHtml += '<span class="contra-star contra-star-full">★</span>';
    }
    
    // Half star
    if (hasHalfStar) {
      starsHtml += '<span class="contra-star contra-star-half">★</span>';
    }
    
    // Empty stars
    for (let i = 0; i < emptyStars; i++) {
      starsHtml += '<span class="contra-star contra-star-empty">☆</span>';
    }
    
    element.innerHTML = starsHtml;
    
    // Also update any rating text elements in the same card
    const card = element.closest('[data-contra-template]') || element.closest('.expert-card');
    if (card) {
      const ratingTextElements = this.querySelectorAll(card, '[data-contra-rating-text]');
      ratingTextElements.forEach(textElement => {
        textElement.textContent = rating.toFixed(1);
      });
    }
  }

  /**
   * Media type detection and element handling
   */
  private isMediaField(element: Element): boolean {
    const field = this.getAttr(element, ATTRS.field);
    // Only apply advanced media handling to project cover URLs, not avatars
    return field === 'coverUrl';
  }

  /**
   * Media value setting with automatic type detection
   */
  private setMediaValue(element: Element, url: string): void {
    const mediaType = this.detectMediaType(url);
    const parent = element.parentElement;
    
    if (!parent) {
      this.log('Media element has no parent for replacement', element);
      return;
    }

    // Remove existing media element
    element.remove();

    // Create appropriate media element
    let mediaElement: HTMLElement;
    
    switch (mediaType) {
      case 'video':
        const transformedVideoUrl = this.transformMediaUrl(url, 'video');
        mediaElement = this.createVideoElement(transformedVideoUrl, element);
        break;
      case 'image':
      default:
        const transformedImageUrl = this.transformMediaUrl(url, 'image');
        mediaElement = this.createImageElement(transformedImageUrl, element);
        break;
    }

    // Preserve classes and attributes from original element
    this.transferAttributes(element, mediaElement);
    
    // Insert new media element
    parent.appendChild(mediaElement);
    
    this.log(`Created ${mediaType} element for URL: ${url}`);
  }

  /**
   * Detect media type from URL
   */
  private detectMediaType(url: string): 'image' | 'video' {
    if (!url || typeof url !== 'string') {
      this.log('Invalid URL provided to detectMediaType:', url);
      return 'image';
    }
    
    const urlLower = url.toLowerCase();
    
    // If optimizing GIFs as videos, treat them as such immediately.
    if (this.config.optimizeGifsAsVideo && urlLower.endsWith('.gif')) {
        return 'video';
    }
    
    // Video formats - check for extensions and Cloudinary video path
    const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.ogg'];
    const isVideoExtension = videoExtensions.some(ext => urlLower.endsWith(ext));
    const isCloudinaryVideo = urlLower.includes('cloudinary.com/') && urlLower.includes('/video/');
    
    if (isVideoExtension || isCloudinaryVideo) {
      return 'video';
    }
    
    // Default to image
    return 'image';
  }

  /**
   * Create video element with fallback
   */
  private createVideoElement(url: string, originalElement: Element): HTMLVideoElement {
    const video = document.createElement('video');
    
    // Video attributes
    video.src = url;
    video.loop = this.config.videoLoop;
    video.playsInline = true; // Essential for inline playback on iOS
    video.preload = 'metadata';
    video.controls = this.config.videoControls;
    
    // Set a poster image proactively for better mobile compatibility and UX.
    const posterUrl = this.extractVideoThumbnail(url);
    if (posterUrl) {
      video.poster = posterUrl;
      this.log(`Set poster for video ${url}: ${posterUrl}`);
    }

    // Muted is critical for autoplay on mobile.
    if (this.config.videoMuted) {
        video.muted = true;
        video.setAttribute('muted', ''); // Set attribute for maximum compatibility
    }
    
    // Maintain aspect ratio and object-fit from original
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';
    video.style.borderRadius = 'inherit';
    
    // Autoplay configuration
    if (this.config.videoAutoplay) {
      video.autoplay = true;
      video.setAttribute('autoplay', '');
      
      // Programmatically play the video to support mobile autoplay, which often ignores the attribute alone.
      // The promise is caught to handle cases where the browser blocks autoplay (e.g., Low Power Mode).
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          this.log('Autoplay was prevented.', { error, videoUrl: url });
        });
      }
    }
    
    // Error handling with fallback to poster or placeholder
    video.onerror = () => {
      this.log(`Video failed to load: ${url}`);
      // Create a fallback image element
      const fallbackImg = this.createImageElement(posterUrl || url, originalElement);
      if (video.parentElement) {
        video.parentElement.replaceChild(fallbackImg, video);
      }
    };

    // Hover-to-play functionality (if enabled and not autoplay)
    if (this.config.videoHoverPlay && !this.config.videoAutoplay) {
      // --- Desktop hover events ---
      video.addEventListener('mouseenter', () => {
        video.currentTime = 0;
        video.play().catch(() => { /* Ignore play errors */ });
        });
      video.addEventListener('mouseleave', () => {
        video.pause();
        video.currentTime = 0;
      });
      
      // --- Mobile & Desktop click/tap events ---
      video.addEventListener('click', (e) => {
        e.preventDefault(); // Prevent navigation if video is in a link
        if (video.paused) {
          video.currentTime = 0;
          video.play().catch((err) => this.log('Video play failed on click', err));
        } else {
          video.pause();
        }
      });
    }

    return video;
  }

  /**
   * Create image element with error handling
   */
  private createImageElement(url: string, originalElement: Element): HTMLImageElement {
    const img = document.createElement('img');
    
    img.src = url;
    img.alt = originalElement.getAttribute('alt') || 'Media content';
    img.loading = 'lazy';
    
    // Maintain styling
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.borderRadius = 'inherit';
    
    // Error handling
    img.onerror = () => {
      this.log(`Image failed to load: ${url}`);
      img.style.background = '#f3f4f6';
      img.style.opacity = '0.5';
      img.alt = 'Image unavailable';
      
      // Add broken image icon
      img.style.position = 'relative';
      const placeholder = document.createElement('div');
      placeholder.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: #9ca3af;
        font-size: 12px;
        text-align: center;
      `;
      placeholder.textContent = '🖼️ Image unavailable';
      img.parentElement?.appendChild(placeholder);
    };

    return img;
  }

  /**
   * Extract video thumbnail from Cloudinary URL
   */
  private extractVideoThumbnail(videoUrl: string): string | null {
    // Loosened the check to work for any Cloudinary upload URL
    if (!videoUrl.includes('/upload/')) {
        this.log('URL does not appear to be a Cloudinary video, cannot generate poster.', videoUrl);
    return null;
    }

    // Always change the file extension to .jpg for the poster
    let posterUrl = videoUrl.replace(/\.(mp4|webm|mov|avi|mkv|ogg|gif)$/i, '.jpg');

    const uploadMarker = '/upload/';
    const parts = posterUrl.split(uploadMarker);

    if (parts.length !== 2) {
        this.log(`Could not parse URL for thumbnail generation: ${videoUrl}`);
        return posterUrl;
    }

    const [baseUrl, path] = parts;
    let pathComponents = path.split('/');
    
    const firstPathComponent = pathComponents[0];
    const hasTransformations = CLOUDINARY_TRANSFORM_PREFIXES.some(prefix => firstPathComponent.includes(prefix));

    if (!hasTransformations) {
        this.log(`No Cloudinary transformations found, returning basic .jpg poster URL for: ${videoUrl}`);
        return posterUrl;
    }

    let transformations = pathComponents.shift() || '';
    
    // Remove params not ideal for a static poster (e.g., flags like fl_progressive)
    const params = transformations.split(',');
    const filteredParams = params.filter(param => 
        !param.startsWith('fl_') && 
        param !== 'f_auto'
    );

    const newTransformations = filteredParams.join(',');

    if (newTransformations) {
        pathComponents.unshift(newTransformations);
    }

    const newPath = pathComponents.join('/');
    const finalUrl = `${baseUrl}${uploadMarker}${newPath}`;
    
    this.log(`Generated poster URL: ${finalUrl} from video URL: ${videoUrl}`);
    return finalUrl;
  }

  /**
   * Transfer attributes and classes from old element to new
   */
  private transferAttributes(from: Element, to: HTMLElement): void {
    // Transfer classes
    if (from.className) {
      to.className = from.className;
    }
    
    // Transfer data attributes (except contra-field)
    Array.from(from.attributes).forEach(attr => {
      if (attr.name.startsWith('data-') && attr.name !== `${ATTR_PREFIX}${ATTRS.field}`) {
        to.setAttribute(attr.name, attr.value);
      }
    });
    
    // Transfer style
    if (from.getAttribute('style')) {
      const existingStyle = to.getAttribute('style') || '';
      to.setAttribute('style', existingStyle + '; ' + from.getAttribute('style'));
    }
  }

  /**
   * Handle repeating elements (projects, social links)
   */
  private populateRepeatingElements(card: Element, expert: ExpertProfile, listId: string): void {
    const repeatElements = this.querySelectorAll(card, `[${ATTR_PREFIX}${ATTRS.repeat}]`);
    
    repeatElements.forEach(container => {
      const repeatType = this.getAttr(container, ATTRS.repeat);
      const maxItems = parseInt(this.getAttr(container, ATTRS.max) || '10');
      
      if (repeatType === 'projects' && expert.projects) {
        this.populateRepeatingContainer(container, expert.projects.slice(0, maxItems), listId);
      } else if (repeatType === 'socialLinks' && expert.socialLinks) {
        this.populateRepeatingContainer(container, expert.socialLinks.slice(0, maxItems), listId);
      } else if (repeatType === 'skillTags' && expert.skillTags) {
        this.populateRepeatingContainer(container, expert.skillTags.slice(0, maxItems).map((tag: string) => ({ name: tag })), listId);
      }
    });
  }

  /**
   * Populate a repeating container with items
   */
  private populateRepeatingContainer(container: Element, items: any[], listId: string): void {
    const template = container.firstElementChild;
    if (!template) return;

    // Clear existing items
    container.innerHTML = '';
    
    // Create items from template
    items.forEach(item => {
      const itemElement = template.cloneNode(true) as Element;
      // The template pollution is fixed, so we can reliably use populateFields for all item types.
      this.populateFields(itemElement, item, listId);
      container.appendChild(itemElement);
    });
    
    // Hide container if no items
    if (items.length === 0) {
      (container as HTMLElement).style.display = 'none';
    }
  }

  /**
   * Handle conditional display based on data
   */
  private handleConditionalDisplay(card: Element, expert: ExpertProfile): void {
    const conditionalElements = this.querySelectorAll(card, `[${ATTR_PREFIX}${ATTRS.showWhen}], [${ATTR_PREFIX}${ATTRS.hideWhen}]`);
    
    conditionalElements.forEach(element => {
      const showWhen = this.getAttr(element, ATTRS.showWhen);
      const hideWhen = this.getAttr(element, ATTRS.hideWhen);
      
      let shouldShow = true;
      
      if (showWhen) {
        shouldShow = this.evaluateCondition(expert, showWhen);
      }
      
      if (hideWhen) {
        shouldShow = shouldShow && !this.evaluateCondition(expert, hideWhen);
      }
      
      (element as HTMLElement).style.display = shouldShow ? '' : 'none';
    });
  }

  /**
   * Evaluate a condition against expert data
   */
  private evaluateCondition(expert: ExpertProfile, condition: string): boolean {
    if (!condition || typeof condition !== 'string') {
      this.log('Invalid condition provided:', condition);
      return false;
    }
    
    // Parse condition: "field:value" or "field:>value" etc.
    const parts = condition.split(':');
    if (parts.length < 2) {
      this.log('Invalid condition format:', condition);
      return false;
    }
    
    const field = parts[0];
    const restOfCondition = parts.slice(1).join(':'); // Handle colons in values
    const expertValue = (expert as any)[field];
    
    this.log(`Evaluating condition: ${field} (${expertValue}, type: ${typeof expertValue}) against ${restOfCondition}`);
    
    if (expertValue == null) {
      this.log(`Field '${field}' is null/undefined, condition fails`);
      return false;
    }
    
    // Check for comparison operators
    if (restOfCondition.startsWith('>=')) {
      const value = restOfCondition.substring(2);
      const result = Number(expertValue) >= Number(value);
      this.log(`Comparison: ${expertValue} >= ${value} = ${result}`);
      return result;
    } else if (restOfCondition.startsWith('<=')) {
      const value = restOfCondition.substring(2);
      const result = Number(expertValue) <= Number(value);
      this.log(`Comparison: ${expertValue} <= ${value} = ${result}`);
      return result;
    } else if (restOfCondition.startsWith('>')) {
      const value = restOfCondition.substring(1);
      const result = Number(expertValue) > Number(value);
      this.log(`Comparison: ${expertValue} > ${value} = ${result}`);
      return result;
    } else if (restOfCondition.startsWith('<')) {
      const value = restOfCondition.substring(1);
      const result = Number(expertValue) < Number(value);
      this.log(`Comparison: ${expertValue} < ${value} = ${result}`);
      return result;
    } else {
      // Direct value comparison with type-aware handling
      let result = false;
      
      // Handle boolean fields specially
      if (typeof expertValue === 'boolean') {
        // Convert string condition to boolean for comparison
        if (restOfCondition.toLowerCase() === 'true') {
          result = expertValue === true;
        } else if (restOfCondition.toLowerCase() === 'false') {
          result = expertValue === false;
        } else {
          result = false;
        }
        this.log(`Boolean comparison: ${expertValue} === ${restOfCondition.toLowerCase() === 'true'} = ${result}`);
      } else if (typeof expertValue === 'number') {
        // Handle numeric comparisons
        const numValue = Number(restOfCondition);
        result = !isNaN(numValue) && expertValue === numValue;
        this.log(`Number comparison: ${expertValue} === ${numValue} = ${result}`);
      } else {
        // String comparison (case-insensitive)
        const expertStr = String(expertValue);
        const valueStr = String(restOfCondition);
        result = expertStr.toLowerCase() === valueStr.toLowerCase();
        this.log(`String comparison: '${expertStr}' === '${valueStr}' = ${result}`);
      }
      
      return result;
    }
  }

  /**
   * Update UI states based on current data for a specific list.
   */
  private updateUIStates(listElement: Element, listId: string): void {
    const state = this.state.getState(listId);
    
    const emptyElement = this.querySelector(listElement, `[${ATTR_PREFIX}${ATTRS.empty}]`);
    if (emptyElement) {
        const showEmpty = !state.loading && state.experts.length === 0;
        const display = showEmpty ? 'block' : 'none';
        (emptyElement as HTMLElement).style.setProperty('display', display, 'important');
        this.log(`List ${listId}: Empty state display set to '${display}'.`);
    }
    
    const loadMoreButton = this.querySelector(document.body, `[${ATTR_PREFIX}${ATTRS.action}="load-more"][${ATTR_PREFIX}${ATTRS.listTarget}="${listId}"]`);
    if (loadMoreButton) {
      const btn = loadMoreButton as HTMLButtonElement;
      const hasMore = !state.loading && state.hasNextPage;
      const display = hasMore ? 'inline-block' : 'none';
      (loadMoreButton as HTMLElement).style.setProperty('display', display, 'important');
      btn.disabled = state.loading;
      btn.textContent = state.loading ? 'Loading...' : 'Load More';
    }
  }

  /**
   * Handle action buttons (just load-more for now).
   */
  private handleAction(action: string, targetListId: string, button: Element): void {
    if (action === 'load-more') {
      const listElement = this.querySelector(document.body, `[${ATTR_PREFIX}${ATTRS.listId}="${targetListId}"]`);
      const programId = this.getAttr(listElement!, ATTRS.program);
      if (listElement && programId) {
        this.loadExperts(targetListId, programId, true); // `true` to append
      } else {
        this.log(`Could not find list or program for target: ${targetListId}`);
      }
    } else if (action === 'clear-filters') {
      this.clearFilters(targetListId);
    }
  }

  private clearFilters(targetListId: string): void {
    const listElement = this.querySelector(document.body, `[${ATTR_PREFIX}${ATTRS.listId}="${targetListId}"]`);
    if (!listElement) {
        this.log(`Cannot find list element with ID: ${targetListId} to clear filters.`);
        return;
    }
    const programId = this.getAttr(listElement, ATTRS.program);
    if (!programId) {
        this.log(`Cannot find programId for list: ${targetListId}`);
        return;
    }

    this.log(`Clearing filters for list: ${targetListId}`);

    // 1. Reset state
    this.state.updateState(targetListId, { filters: {}, offset: 0 });

    // 2. Reset controls visually
    const filterControls = this.querySelectorAll(document.body, `[data-contra-filter][data-contra-list-target="${targetListId}"]`);
    filterControls.forEach(control => {
        this.resetControlValue(control as HTMLInputElement | HTMLSelectElement);
    });

    // 3. Reload data
    this.loadExperts(targetListId, programId, false); // false to replace, not append
  }

  private resetControlValue(control: HTMLInputElement | HTMLSelectElement): void {
    if (control instanceof HTMLInputElement) {
        switch (control.type) {
            case 'checkbox':
            case 'radio':
                control.checked = false;
                break;
            case 'number':
            case 'range':
                control.value = '';
                break;
            default: // text, search, etc.
                control.value = '';
                break;
        }
    } else if (control instanceof HTMLSelectElement) {
        control.selectedIndex = 0; // Reset to the first option
    }
  }

  private updateFilterAndReload(listId: string, programId: string, filterKey: string, value: any): void {
    const state = this.state.getState(listId);
    const newFilters = { ...state.filters };

    // Process and set value
    let processedValue = value;
    if (filterKey === 'available') {
      // If checkbox is checked, value is true. If unchecked, it's false.
      // We only want to apply the filter when it's true.
      processedValue = value ? true : undefined;
    } else if (['minRate', 'maxRate'].includes(filterKey)) {
      processedValue = (value === '' || value === null) ? undefined : Number(value);
    } else if (filterKey === 'languages' && typeof value === 'string') {
        processedValue = value.split(',').map(v => v.trim()).filter(v => v);
        if (processedValue.length === 0) {
            processedValue = undefined;
        }
    }

    if (processedValue !== undefined && processedValue !== '') {
        const apiKey = this.filterNameMap[filterKey] || filterKey;
        (newFilters as any)[apiKey] = processedValue;
    } else {
        const apiKey = this.filterNameMap[filterKey] || filterKey;
        delete (newFilters as any)[apiKey];
    }
    
    // Reset offset and update state
    this.state.updateState(listId, { filters: newFilters, offset: 0 });

    this.log(`Filter updated for list ${listId}, reloading. New filters:`, newFilters);
    
    // Reload the list
    this.loadExperts(listId, programId, false);
  }

  private wireFilterControls(): void {
    const filterControls = this.querySelectorAll(document.body, `[data-contra-filter]`);
    this.log(`Found ${filterControls.length} filter controls to wire.`);

    filterControls.forEach(control => {
        const filterKey = control.getAttribute('data-contra-filter');
        const targetListId = control.getAttribute('data-contra-list-target');

        if (!filterKey || !targetListId) {
            this.log('Filter control missing required attributes: data-contra-filter or data-contra-list-target', control);
            return;
        }

        const listElement = this.querySelector(document.body, `[${ATTR_PREFIX}list-id="${targetListId}"]`);
        if (!listElement) return;
        const programId = this.getAttr(listElement, ATTRS.program);
        if (!programId) return;

        const debounceTime = (control instanceof HTMLInputElement && ['text', 'search'].includes(control.type)) ? 300 : 0;
        
        const handler = () => {
            const value = this.getControlValue(control as HTMLInputElement | HTMLSelectElement);
            this.updateFilterAndReload(targetListId, programId, filterKey, value);
        };
        
        const debouncedHandler = this.debounce(handler, debounceTime);
        
        const eventType = (control instanceof HTMLInputElement && ['text', 'search'].includes(control.type)) ? 'input' : 'change';
        control.addEventListener(eventType, debouncedHandler);
    });
  }

  private debounce(func: (...args: any[]) => void, delay: number): (...args: any[]) => void {
    let timeoutId: number;
    return (...args: any[]) => {
        clearTimeout(timeoutId);
        if (delay > 0) {
            timeoutId = window.setTimeout(() => func.apply(this, args), delay);
        } else {
            func.apply(this, args);
        }
    };
  }

  /**
   * Utility Methods
   */
  private getAttr(element: Element, name: string): string | null {
    return element.getAttribute(`${ATTR_PREFIX}${name}`);
  }

  private querySelector(element: Element, selector: string): Element | null {
    return element.querySelector(selector);
  }

  private querySelectorAll(element: Element, selector: string): Element[] {
    return Array.from(element.querySelectorAll(selector));
  }

  private parseFiltersFromElement(element: Element): ExpertFilters {
    const filters: ExpertFilters = {};
    
    // Parse filter attributes
    const filterMap = {
      'available': 'available',
      'languages': 'languages', 
      'location': 'location',
      'min-rate': 'minRate',
      'max-rate': 'maxRate',
      'sort': 'sortBy',
      'limit': 'limit',
      'offset': 'offset'
    };

    Object.entries(filterMap).forEach(([attr, filterKey]) => {
      const value = this.getAttr(element, attr);
      if (value != null) {
        if (filterKey === 'available') {
          (filters as any)[filterKey] = value === 'true';
        } else if (filterKey === 'languages') {
          (filters as any)[filterKey] = value.split(',').map(v => v.trim());
        } else if (['minRate', 'maxRate', 'limit', 'offset'].includes(filterKey)) {
          (filters as any)[filterKey] = parseInt(value);
        } else {
          (filters as any)[filterKey] = value;
        }
      }
    });

    // Ensure offset defaults to 0 if not specified
    if (filters.offset === undefined) {
      filters.offset = 0;
    }

    return filters;
  }

  private getControlValue(control: HTMLInputElement | HTMLSelectElement): any {
    if (control instanceof HTMLInputElement) {
      switch (control.type) {
        case 'checkbox':
          return control.checked;
        case 'number':
        case 'range':
          return control.valueAsNumber;
        default:
          return control.value;
      }
    } else if (control instanceof HTMLSelectElement) {
      if (control.multiple) {
        return Array.from(control.selectedOptions).map(option => option.value);
      }
      return control.value;
    }
    return null;
  }

  private showLoading(container: Element, show: boolean): void {
    const loadingElement = this.querySelector(container, `[${ATTR_PREFIX}${ATTRS.loading}]`);
    if (loadingElement) {
      const display = show ? 'block' : 'none';
      (loadingElement as HTMLElement).style.setProperty('display', display, 'important');
    }
  }

  private showError(container: Element, error: Error): void {
    const errorElement = this.querySelector(container, `[${ATTR_PREFIX}${ATTRS.error}]`);
    if (errorElement) {
      errorElement.textContent = error.message;
      (errorElement as HTMLElement).style.setProperty('display', 'block', 'important');
    }
    (container as HTMLElement).classList.add(this.config.errorClass);
    this.log('Error displayed', error);
  }

  private dispatchEvent(target: Element | Document, eventName: string, detail: any): void {
    const event = new CustomEvent(`contra:${eventName}`, { detail });
    target.dispatchEvent(event);
  }

  private log(message: string, ...args: any[]): void {
    if (this.config.debug) {
      console.log(`[ContraWebflow] ${message}`, ...args);
    }
  }

  private async getAvailableFilters(programId: string): Promise<any[]> {
    const url = `https://contra.com/public-api/programs/${programId}/filters`;
    this.log(`Fetching available filters for program: ${programId}`);
    try {
        const response = await fetch(url, {
            headers: {
                'X-API-Key': this.config.apiKey,
                'Accept': 'application/json'
            }
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch filters: ${response.statusText}`);
        }
        const data = await response.json();
        this.log('Successfully fetched filters', data.data);
        return data.data || [];
    } catch (error) {
        this.log('Error fetching available filters', error);
        return [];
    }
  }
  
  private getFilterOptionLabel(filterKey: string, value: string): string {
    const labels = this.filterOptionLabels[filterKey];
    if (labels && labels[value]) {
      return labels[value];
    }
    // Capitalize the first letter and lowercase the rest as a fallback
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }

  private populateAllFilterControls(programFilters: Map<string, any[]>): void {
    this.log('Populating all filter controls on the page...');
    const allControls = this.querySelectorAll(document.body, `[data-contra-filter]`);

    allControls.forEach(control => {
      const targetListId = control.getAttribute('data-contra-list-target');
      if (!targetListId) return;

      const targetList = this.querySelector(document.body, `[data-contra-list-id="${targetListId}"]`);
      if (!targetList) return;

      const programId = this.getAttr(targetList, ATTRS.program);
      if (!programId) return;

      const filters = programFilters.get(programId);
      if (!filters) return;

      const filterKey = control.getAttribute('data-contra-filter');
      const filterDef = filters.find(f => f.name === filterKey);

      if (!filterDef) return;

      // Handle number input ranges
      if (filterDef.type === 'number' && control instanceof HTMLInputElement) {
        if (filterDef.minimum !== undefined) control.min = String(filterDef.minimum);
        if (filterDef.maximum !== undefined) control.max = String(filterDef.maximum);
      }
      
      // Handle populating controls with options (select, datalist)
      if (filterDef.options) {
          if (control instanceof HTMLSelectElement) {
              this.populateSelectControl(control, filterKey!, filterDef.options);
          } else if (control instanceof HTMLInputElement && control.getAttribute('list')) {
              this.populateDatalistControl(control, filterKey!, filterDef.options);
          }
      }
    });
  }

  private populateSelectControl(control: HTMLSelectElement, filterKey: string, options: any[]): void {
    this.log(`Populating options for filter '${filterKey}' on control`, control);
    
    const placeholder = control.firstElementChild?.cloneNode(true) as Element | null;
    control.innerHTML = '';
    if (placeholder && placeholder.getAttribute('value') === '') {
      control.appendChild(placeholder);
    }

    options.forEach((option: any) => {
      const optionElement = document.createElement('option');
      const value = typeof option === 'object' && option.value !== undefined ? option.value : String(option);
      
      optionElement.value = value;

      let label: string;
      if (filterKey === 'locations') {
        const labelMatch = value.match(/^(.*?)\s*\(/);
        label = labelMatch ? labelMatch[1].trim() : value;
      } else {
        label = this.getFilterOptionLabel(filterKey!, value);
      }
      optionElement.textContent = label;
      
      if (filterKey === 'sortBy' && value === 'relevance') {
        optionElement.selected = true;
      }
      control.appendChild(optionElement);
    });
  }

  private populateDatalistControl(control: HTMLInputElement, filterKey: string, options: any[]): void {
      const datalistId = control.getAttribute('list');
      if (!datalistId) return;

      const datalist = document.getElementById(datalistId);
      if (!datalist) {
          this.log(`Datalist with id '${datalistId}' not found for input control.`, control);
          return;
      }

      this.log(`Populating datalist '#${datalistId}' for filter '${filterKey}'`);
      datalist.innerHTML = ''; // Clear existing options

      options.forEach((option: any) => {
          const optionElement = document.createElement('option');
          const value = typeof option === 'object' && option.value !== undefined ? option.value : String(option);
          
          let displayValue = value;
          // For locations, we want a cleaner value for the user to select.
          if (filterKey === 'locations') {
              const labelMatch = value.match(/^(.*?)\s*\(/);
              displayValue = labelMatch ? labelMatch[1].trim() : value;
          }

          optionElement.value = displayValue;
          datalist.appendChild(optionElement);
      });
  }

  private transformMediaUrl(url: string, mediaType: 'image' | 'video'): string {
    if (!url || (!url.includes('cloudinary.com/') && !url.includes('media.contra.com/'))) {
        return url;
    }

    const transformations = mediaType === 'image' 
        ? this.config.imageTransformations 
        : this.config.videoTransformations;

    if (!transformations) {
        return url;
    }

    let processedUrl = url;
    if (mediaType === 'video' && url.toLowerCase().endsWith('.gif')) {
        processedUrl = url.replace(/\.gif$/i, '.mp4');
        this.log(`Converting GIF to MP4: ${processedUrl}`);
    }

    const uploadMarker = '/upload/';
    const parts = processedUrl.split(uploadMarker);

    if (parts.length !== 2) {
        this.log(`Could not apply transformations, URL format unexpected: ${processedUrl}`);
        return processedUrl;
    }
    
    const [baseUrl, path] = parts;
    let pathComponents = path.split('/');
    
    const firstPathComponent = pathComponents[0];
    const hasExistingTransformations = CLOUDINARY_TRANSFORM_PREFIXES.some(prefix => firstPathComponent.includes(prefix));

    if (hasExistingTransformations) {
        this.log(`Removing existing transformations from URL: ${processedUrl}`);
        pathComponents.shift();
    }

    const cleanPath = pathComponents.join('/');
    const finalUrl = `${baseUrl}${uploadMarker}${transformations}/${cleanPath}`;
    
    this.log(`Transformed ${mediaType} URL from "${url}" to "${finalUrl}"`);
    return finalUrl;
  }

  private _stringifyFilters(filters: ExpertFilters): string {
    return Object.entries(filters)
      .filter(([, value]) => {
        if (value === null || value === undefined) return false;
        if (Array.isArray(value) && value.length === 0) return false; // Exclude empty arrays
        if (typeof value === 'string' && value.trim() === '') return false; // Exclude empty strings
        // Keep numbers (like 0) and booleans
        return true;
      })
      .map(([key, value]) => {
        const stringValue = Array.isArray(value) ? value.join(',') : String(value);
        return `${key}:${stringValue}`;
      })
      .join('|');
  }

  private _appendContraAnalytics(url: string, listId: string): string {
    if (!this.config.contraAnalytics || !url) {
      return url;
    }

    try {
      // Find the list element in the main document to ensure it's the rendered one
      const listElement = document.querySelector(`[${ATTR_PREFIX}${ATTRS.listId}="${listId}"]`);
      if (!listElement) return url;

      const programId = this.getAttr(listElement, ATTRS.program);
      const state = this.state.getState(listId);
      
      // We want the *current* filters from the state, which is correct
      const filters = state.filters;

      const params = new URLSearchParams();
      params.set('contra_source', 'webflow_sdk');
      if (programId) params.set('contra_program_id', programId);
      if (listId) params.set('contra_list_id', listId);
      
      const filterString = this._stringifyFilters(filters);
      if (filterString) {
        params.set('contra_filters', filterString);
      }

      // Check if the URL is valid before creating a URL object
      if (!url.startsWith('http')) {
        this.log('Cannot append analytics to a relative or invalid URL', { url });
        return url;
      }

      const urlObject = new URL(url);
      
      params.forEach((value, key) => {
        // Use set instead of append to avoid duplicate params if logic is ever re-run
        urlObject.searchParams.set(key, value);
      });

      return urlObject.toString();

    } catch (error) {
      this.log('Failed to append Contra analytics to URL.', { url, error });
      return url; // Return original URL on error
    }
  }
}

/**
 * Auto-initialize runtime when DOM is ready
 */
function autoInit(): void {
  const configElement = document.getElementById('contra-config');
  if (!configElement) {
    console.warn('[ContraWebflow] No config element found. Runtime not initialized.');
    return;
  }

  try {
    const config = JSON.parse(configElement.textContent || '{}');
    
    // Validate required config
    if (!config.apiKey) {
      console.error('[ContraWebflow] API key is required in config.');
      return;
    }
    
    const initializeRuntime = () => {
    const runtime = new ContraWebflowRuntime(config);
    
    // Expose runtime globally for debugging
    (window as any).contraRuntime = runtime;
    
    runtime.init().catch(error => {
      console.error('[ContraWebflow] Runtime initialization failed:', error);
    });
    };
    
    // Use setTimeout to ensure DOM is fully ready
    setTimeout(initializeRuntime, 100);
    
  } catch (error) {
    console.error('[ContraWebflow] Failed to parse config:', error);
  }
}

// Auto-initialize when DOM is ready with multiple fallbacks
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoInit);
} else if (document.readyState === 'interactive') {
  // DOM is ready but resources might still be loading
  setTimeout(autoInit, 50);
} else {
  // DOM and resources are ready
  autoInit();
}

// Export runtime class for manual initialization
export { ContraWebflowRuntime as default }; 