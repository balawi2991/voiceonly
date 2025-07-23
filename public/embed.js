(function() {
  'use strict';

  // إصدار البوت - يتم تحديثه مع كل تطوير
  const SANAD_BOT_VERSION = '1.0.4';
  console.log(`Sanad Bot v${SANAD_BOT_VERSION} loading...`);

  // التحقق من وجود البوت مسبقاً
  if (window.SanadBot) {
    console.warn(`Sanad Bot v${window.SanadBot.version || 'unknown'} is already loaded`);
    return;
  }

  // تحديد baseUrl تلقائياً
  function getBaseUrl() {
    try {
      // البحث عن script tag الحالي
      const scripts = document.querySelectorAll('script[src*="embed.js"]');
      let embedScript = null;

      // العثور على script الصحيح
      for (let script of scripts) {
        if (script.src && script.src.includes('embed.js')) {
          embedScript = script;
          break;
        }
      }

      if (embedScript && embedScript.src) {
        const url = new URL(embedScript.src);
        let baseUrl = `${url.protocol}//${url.host}`;
        
        // للـ localhost، لا نقوم بترقية البروتوكول لتجنب مشاكل SSL
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
          console.log('🏠 Localhost detected, keeping original protocol:', baseUrl);
          return baseUrl;
        }
        
        // للمواقع الخارجية، ترقية البروتوكول إذا لزم الأمر
        if (window.location.protocol === 'https:' && url.protocol === 'http:') {
          baseUrl = baseUrl.replace('http:', 'https:');
          console.log('🔒 Upgraded to HTTPS for mixed content compatibility:', baseUrl);
        }
        
        console.log('Detected base URL from script source:', baseUrl);
        return baseUrl;
      }

      // fallback للتطوير المحلي - استخدم HTTP دائماً للـ localhost
       if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
         const fallbackUrl = 'http://localhost:3001';
         console.log('🏠 Using localhost fallback with HTTP:', fallbackUrl);
         return fallbackUrl;
       }

       // fallback عام - استخدم نفس بروتوكول الصفحة المضيفة للمواقع الخارجية
       const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
       const defaultUrl = `${protocol}//localhost:3001`;
       console.log('Using default fallback with protocol:', defaultUrl);
       return defaultUrl;
     } catch (error) {
       console.error('Error detecting base URL:', error);
       // للـ localhost، استخدم HTTP دائماً
       if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
         return 'http://localhost:3001';
       }
       const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
       return `${protocol}//localhost:3001`;
    }
  }

  // إعدادات افتراضية
  const DEFAULT_CONFIG = {
    baseUrl: getBaseUrl(),
    position: 'bottom-right'
  };

  class SanadBot {
    constructor() {
      this.version = SANAD_BOT_VERSION;
      this.config = { ...DEFAULT_CONFIG };
      this.agentId = null;
      this.isInitialized = false;
      this.container = null;
      this.widget = null;
      this.botConfig = null;
      this.widgetState = 'idle';
      this.callDuration = 0;
      this.callTimer = null;
      this.mediaRecorder = null;
      this.audioChunks = [];
      this.sessionId = null;
      this.configUpdateInterval = null;

      this.init();
    }

    init() {
      console.log('Sanad Bot initializing...');
      console.log('Base URL:', this.config.baseUrl);
      console.log('Current location:', window.location.href);

      // جلب معرف الوكيل من script tag
      const script = document.currentScript ||
        document.querySelector('script[data-agent-id]');

      if (script) {
        this.agentId = script.getAttribute('data-agent-id');
        console.log('Agent ID found:', this.agentId);

        // جلب إعدادات إضافية
        const position = script.getAttribute('data-position');
        const size = script.getAttribute('data-size');
        const theme = script.getAttribute('data-theme');

        if (position) this.config.position = position;
        if (size) this.config.size = size;
        if (theme) this.config.theme = theme;
      }

      if (!this.agentId) {
        console.error('Sanad Bot: Agent ID is required');
        return;
      }

      // انتظار تحميل DOM
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.render());
      } else {
        this.render();
      }
    }

    async fetchBotConfig() {
      try {
        // إضافة cache busting للتأكد من الحصول على أحدث البيانات
        const timestamp = Date.now();
        const configUrl = `${this.config.baseUrl}/api/bot/config/${this.agentId}?_t=${timestamp}`;
        console.log('🔄 Fetching bot config from:', configUrl);

        const response = await fetch(configUrl, {
          // إضافة headers لمنع التخزين المؤقت
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        });
        console.log('📡 Config response status:', response.status);

        const result = await response.json();
        console.log('📋 Config result:', result);

        if (result.success && result.data) {
          this.botConfig = {
            name: result.data.name || 'مساعد ذكي',
            avatarEmoji: result.data.avatar_emoji || '🤖',
            voiceId: result.data.voice_id || 'ar-male-1',
            welcomeMessage: result.data.welcome_message || ''
          };
          console.log('✅ Bot config loaded:', this.botConfig);
          console.log('📢 Welcome message:', this.botConfig.welcomeMessage || 'No welcome message set');
        } else {
          console.warn('⚠️ Using default config due to API error:', result);
          // تكوين افتراضي
          this.botConfig = {
            name: 'مساعد ذكي',
            avatarEmoji: '🤖',
            voiceId: 'ar-male-1',
            welcomeMessage: ''
          };
        }
      } catch (error) {
        console.error('❌ Error fetching bot config:', error);
        // تكوين افتراضي في حالة الخطأ
        this.botConfig = {
          name: 'مساعد ذكي',
          avatarEmoji: '🤖',
          voiceId: 'ar-male-1',
          welcomeMessage: ''
        };
      }
    }

    async render() {
      if (this.isInitialized) return;

      try {
        // جلب تكوين البوت أولاً
        await this.fetchBotConfig();

        // إضافة الستايل العام
        this.addGlobalStyles();

        // إنشاء الحاوية الرئيسية
        this.container = document.createElement('div');
        this.container.id = 'sanad-bot-container';
        this.container.style.cssText = this.getContainerStyles();

        // إنشاء الويدجت (نفس NewVoiceWidget)
        this.createWidget();

        // إضافة الحاوية للصفحة
        document.body.appendChild(this.container);

        // إضافة مستمعي الأحداث
        this.addEventListeners();

        // بدء تحديث التخصيص دورياً (كل 30 ثانية)
        this.startConfigUpdates();

        this.isInitialized = true;
        console.log(`Sanad Bot v${this.version} initialized successfully`);

        // التحقق من وجود إصدار أحدث
        this.checkForUpdates();
      } catch (error) {
        console.error('Failed to initialize Sanad Bot:', error);
      }
    }

    async checkForUpdates() {
      try {
        // التحقق من الإصدار الأحدث كل 5 دقائق
        setInterval(async () => {
          const response = await fetch(`${this.config.baseUrl}/api/embed/version?_t=${Date.now()}`);
          const result = await response.json();

          if (result.success && result.data.version !== this.version) {
            console.warn(`🔄 New Sanad Bot version available: v${result.data.version} (current: v${this.version})`);
            console.warn('💡 Refresh the page to get the latest updates');

            // إشعار اختياري للمطور
            if (window.location.hostname === 'localhost') {
              console.log('🚀 Development mode: Auto-refresh in 3 seconds...');
              setTimeout(() => window.location.reload(), 3000);
            } else {
              // للمواقع الخارجية - إشعار في console فقط
              console.log('🔔 To get the latest features and fixes, please refresh the page');
            }
          }
        }, 5 * 60 * 1000); // كل 5 دقائق
      } catch (error) {
        console.log('Could not check for updates:', error);
      }
    }

    startConfigUpdates() {
      // تحديث التخصيص كل 10 ثوان (أسرع للاختبار)
      this.configUpdateInterval = setInterval(async () => {
        await this.updateBotConfig();
      }, 10000);

      // محاولة إعداد تحديث فوري عبر localStorage
      this.setupInstantUpdates();
    }

    setupInstantUpdates() {
      // مراقبة تغييرات localStorage للتحديث الفوري
      window.addEventListener('storage', (e) => {
        if (e.key === `bot_config_${this.agentId}` || e.key === 'config_updated') {
          console.log('🔔 Config updated via localStorage:', e.key);
          // تحديث فوري مع تأخير قصير للتأكد من حفظ البيانات
          setTimeout(() => {
            this.updateBotConfig();
          }, 100);
        }
      });

      // مراقبة تغييرات localStorage في نفس النافذة
      const originalSetItem = localStorage.setItem;
      const self = this;
      localStorage.setItem = function(key, value) {
        originalSetItem.apply(this, arguments);
        if (key === `bot_config_${self.agentId}` || key === 'config_updated') {
          console.log('🔔 LocalStorage updated:', key);
          window.dispatchEvent(new StorageEvent('storage', {
            key: key,
            newValue: value
          }));
        }
      };

      // إضافة مراقب للأحداث المخصصة
      window.addEventListener('botConfigUpdate', () => {
        console.log('🔔 Bot config update event received');
        this.updateBotConfig();
      });
    }

    async updateBotConfig() {
      try {
        // إضافة cache busting للتأكد من الحصول على أحدث البيانات
        const timestamp = Date.now();
        const response = await fetch(`${this.config.baseUrl}/api/bot/config/${this.agentId}?_t=${timestamp}`);
        const result = await response.json();

        if (result.success && result.data) {
          const newConfig = {
            name: result.data.name || 'مساعد ذكي',
            avatarEmoji: result.data.avatar_emoji || '🤖',
            voiceId: result.data.voice_id || 'ar-male-1',
            welcomeMessage: result.data.welcome_message || ''
          };

          // التحقق من وجود تغييرات
          const hasChanges = JSON.stringify(this.botConfig) !== JSON.stringify(newConfig);

          if (hasChanges) {
            console.log('🔄 Bot config updated:', newConfig);
            
            // التحقق من تغيير رسالة الترحيب تحديداً
            const welcomeMessageChanged = this.botConfig?.welcomeMessage !== newConfig.welcomeMessage;
            if (welcomeMessageChanged) {
              console.log('📢 Welcome message updated:', {
                old: this.botConfig?.welcomeMessage,
                new: newConfig.welcomeMessage
              });
            }
            
            this.botConfig = newConfig;

            // تحديث الويدجت فوراً
            this.updateWidget();
            
            // إشعار في console للمطور
            console.log('✅ Widget updated with new configuration');
          }
        }
      } catch (error) {
        console.error('Error updating bot config:', error);
      }
    }

    createWidget() {
      // إنشاء الويدجت الرئيسي
      this.widget = document.createElement('div');
      this.widget.className = 'sanad-widget-main';
      this.widget.style.cssText = this.getWidgetStyles();

      // إنشاء زر الإنهاء (مخفي في البداية)
      this.endButton = document.createElement('button');
      this.endButton.className = 'sanad-widget-end-btn';
      this.endButton.style.cssText = this.getEndButtonStyles();
      this.endButton.innerHTML = this.getEndButtonHTML();
      this.endButton.style.display = 'none';
      this.endButton.addEventListener('click', () => this.endCall());

      // إضافة العناصر للحاوية
      const widgetContainer = document.createElement('div');
      widgetContainer.style.cssText = 'display: flex; align-items: center; gap: 12px;';

      widgetContainer.appendChild(this.widget);
      widgetContainer.appendChild(this.endButton);
      this.container.appendChild(widgetContainer);

      // تحديث محتوى الويدجت
      this.updateWidget();

      // إضافة مستمع النقر
      this.widget.addEventListener('click', () => this.handleWidgetClick());
    }

    getContainerStyles() {
      const position = this.config.position;
      let styles = `
        position: fixed;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;

      switch (position) {
        case 'bottom-right':
          styles += 'bottom: 20px; right: 20px;';
          break;
        case 'bottom-left':
          styles += 'bottom: 20px; left: 20px;';
          break;
        case 'top-right':
          styles += 'top: 20px; right: 20px;';
          break;
        case 'top-left':
          styles += 'top: 20px; left: 20px;';
          break;
        default:
          styles += 'bottom: 20px; right: 20px;';
      }

      return styles;
    }

    getWidgetStyles() {
      const isEnded = this.widgetState === 'ending';

      return `
        background: ${isEnded ? '#ffffff' : '#000000'};
        color: ${isEnded ? '#000000' : '#ffffff'};
        border: ${isEnded ? '1px solid #e5e5e5' : 'none'};
        border-radius: 25px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        transition: all 0.3s ease;
        min-width: 200px;
        direction: rtl;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        font-weight: 500;
        animation: ${this.widgetState === 'connecting' ? 'gentlePulse 2s infinite ease-in-out' : 'none'};
      `;
    }

    getEndButtonStyles() {
      return `
        width: 40px;
        height: 40px;
        background: #ef4444;
        border: none;
        border-radius: 50%;
        color: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
        transition: all 0.3s ease;
        font-size: 16px;
      `;
    }

    getEndButtonHTML() {
      return `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;
    }

    updateWidget() {
      if (!this.widget || !this.botConfig) return;

      const stateText = this.getStateText();
      const stateIcon = this.getStateIcon();

      this.widget.innerHTML = `
        <div style="width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%); display: flex; align-items: center; justify-content: center; flex-shrink: 0; position: relative;">
          <div style="font-size: 14px;">${this.botConfig.avatarEmoji}</div>
          ${this.widgetState === 'connected' ? this.getSoundWaves() : ''}
        </div>
        <span style="flex: 1; text-align: right;">${stateText}</span>
        <div style="display: flex; align-items: center; justify-content: center;">
          ${stateIcon}
        </div>
      `;

      // تحديث الستايل
      this.widget.style.cssText = this.getWidgetStyles();

      // إظهار/إخفاء زر الإنهاء
      if (this.endButton) {
        this.endButton.style.display = this.widgetState === 'connected' ? 'flex' : 'none';
      }
    }

    getStateText() {
      if (!this.botConfig) return 'مساعد ذكي';

      switch (this.widgetState) {
        case 'idle':
          return `اسأل ${this.botConfig.name}`;
        case 'connecting':
          return 'جاري الاتصال...';
        case 'connected':
          return `تحدث مع ${this.botConfig.name} • ${this.formatCallDuration()}`;
        case 'ending':
          return 'تم إنهاء المكالمة';
        default:
          return `اسأل ${this.botConfig.name}`;
      }
    }

    formatCallDuration() {
      const mins = Math.floor(this.callDuration / 60);
      const secs = this.callDuration % 60;
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    getStateIcon() {
      switch (this.widgetState) {
        case 'idle':
          return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>';
        case 'connecting':
          return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: pulse 2s infinite;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>';
        case 'connected':
          return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>';
        case 'ending':
          return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        default:
          return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>';
      }
    }

    getSoundWaves() {
      return `
        <div class="sound-wave" style="position: absolute; inset: 0; border-radius: 50%; border: 1px solid rgba(59, 130, 246, 0.5);"></div>
        <div class="sound-wave" style="position: absolute; inset: -4px; border-radius: 50%; border: 1px solid rgba(147, 51, 234, 0.3);"></div>
        <div class="sound-wave" style="position: absolute; inset: -8px; border-radius: 50%; border: 1px solid rgba(6, 182, 212, 0.2);"></div>
      `;
    }

    addGlobalStyles() {
      if (document.getElementById('sanad-bot-styles')) return;

      const style = document.createElement('style');
      style.id = 'sanad-bot-styles';
      style.textContent = `
        @keyframes gentlePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.02); }
        }

        .sanad-widget-main:hover {
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2) !important;
          transform: translateY(-1px) !important;
        }

        .sanad-widget-end-btn:hover {
          background: #dc2626 !important;
          transform: scale(1.05) !important;
        }

        /* تأثيرات الموجات الصوتية */
        @keyframes soundWave {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.1); }
        }

        .sound-wave {
          animation: soundWave 1.5s infinite ease-in-out;
        }

        .sound-wave:nth-child(2) { animation-delay: 0.3s; }
        .sound-wave:nth-child(3) { animation-delay: 0.6s; }
      `;
      document.head.appendChild(style);
    }

    addEventListeners() {
      // تحديث الويدجت عند hover
      if (this.widget) {
        this.widget.addEventListener('mouseenter', () => {
          if (this.widgetState === 'idle') {
            this.widget.style.transform = 'translateY(-1px)';
            this.widget.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.2)';
          }
        });

        this.widget.addEventListener('mouseleave', () => {
          if (this.widgetState === 'idle') {
            this.widget.style.transform = 'translateY(0)';
            this.widget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
          }
        });
      }
    }

    handleWidgetClick() {
      if (this.widgetState === 'idle') {
        this.startCall();
      } else if (this.widgetState === 'ending') {
        this.resetWidget();
      }
      // لا يمكن النقر أثناء الاتصال أو المكالمة
    }

    async startCall() {
      this.updateWidgetState('connecting');

      try {
        // طلب إذن الميكروفون
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // إنشاء جلسة جديدة عبر API
        const formData = new FormData();
        formData.append('agentId', this.agentId);

        const response = await fetch(`${this.config.baseUrl}/api/voice/start`, {
          method: 'POST',
          body: formData
        });

        const result = await response.json();

        if (!result.success) {
          throw new Error(result.error || 'فشل في بدء الجلسة');
        }

        // تخزين معرف الجلسة
        this.sessionId = result.data.sessionId;

        // إعداد MediaRecorder
        this.mediaRecorder = new MediaRecorder(stream);
        this.audioChunks = [];

        this.mediaRecorder.ondataavailable = (event) => {
          this.audioChunks.push(event.data);
        };

        this.mediaRecorder.onstop = () => {
          this.processAudio();
        };

        // بدء التسجيل
        this.mediaRecorder.start();

        // قول رسالة الترحيب أولاً
        await this.playWelcomeMessage();

        // بعد انتهاء رسالة الترحيب، بدء العداد والتسجيل
        this.updateWidgetState('connected');
        this.startCallTimer();

        // بدء تسجيل مقاطع قصيرة كل 3 ثوان
        this.startRecordingLoop();

        // إرسال حدث للتحليلات
        this.trackEvent('call_started');
      } catch (error) {
        console.error('Error starting call:', error);
        if (error.name === 'NotAllowedError') {
          alert('يرجى السماح بالوصول للميكروفون لاستخدام المساعد الصوتي');
        }
        this.resetWidget();
      }
    }

    async playWelcomeMessage() {
      try {
        // التحقق من وجود رسالة ترحيب
        const welcomeText = this.botConfig?.welcomeMessage;
        if (!welcomeText || !welcomeText.trim()) {
          console.log('No welcome message configured');
          return;
        }

        console.log('🎬 بدء تشغيل رسالة الترحيب:', welcomeText.substring(0, 50) + '...');

        // توليد الصوت مباشرة باستخدام Speechify Streaming TTS
        try {
          // محاولة استخدام Speechify Streaming TTS أولاً (نفس النظام الرئيسي)
          console.log('🎤 استخدام Speechify Streaming TTS');
          await this.playStreamingTTS(welcomeText);
          console.log('✅ تم تشغيل Speechify Streaming TTS بنجاح');
        } catch (streamingError) {
          if (streamingError.message && streamingError.message.includes('quota')) {
            console.log('⚠️ تجاوز حصة Speechify API - التبديل إلى Web Speech API');
          } else {
            console.log('❌ فشل Speechify Streaming TTS:', streamingError.message);
          }
          // fallback إلى Web Speech API
          console.log('🗣️ استخدام Web Speech API كبديل');
          if ('speechSynthesis' in window) {
            await this.playTextToSpeech(welcomeText);
            console.log('✅ تم تشغيل Web Speech API بنجاح');
          } else {
            console.error('❌ Web Speech API غير متاح في هذا المتصفح');
          }
        }
      } catch (error) {
        console.error('💥 خطأ عام في تشغيل رسالة الترحيب:', {
          error: error,
          errorName: error?.name,
          errorMessage: error?.message,
          errorStack: error?.stack,
          botConfig: this.botConfig,
          agentId: this.agentId,
          baseUrl: this.config?.baseUrl
        });
        console.log('⏳ انتظار قصير بسبب الخطأ العام');
        // fallback - انتظار قصير
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }


    async playTextToSpeech(text) {
      return new Promise((resolve) => {
        try {
          console.log('استخدام Web Speech API كبديل للنص:', text.substring(0, 50) + '...');
          
          const speakText = () => {
            const utterance = new SpeechSynthesisUtterance(text);

            // إعدادات الصوت
            utterance.lang = 'ar-SA'; // العربية السعودية
            utterance.rate = 0.9;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;

            // البحث عن صوت عربي
            const voices = speechSynthesis.getVoices();
            console.log('الأصوات المتاحة في Web Speech API:', voices.length);
            
            const arabicVoice = voices.find(voice =>
              voice.lang.includes('ar') ||
              voice.name.toLowerCase().includes('arabic') ||
              voice.name.toLowerCase().includes('عربي')
            );

            if (arabicVoice) {
              utterance.voice = arabicVoice;
              console.log('استخدام صوت عربي في Web Speech API:', arabicVoice.name);
            } else {
              console.log('لم يتم العثور على صوت عربي، استخدام الصوت الافتراضي');
              // محاولة استخدام أول صوت متاح
              if (voices.length > 0) {
                utterance.voice = voices[0];
                console.log('استخدام أول صوت متاح:', voices[0].name);
              }
            }

            utterance.onend = () => {
              console.log('انتهى تشغيل Web Speech API بنجاح');
              resolve();
            };

            utterance.onerror = (error) => {
              console.error('خطأ في Web Speech API:', error);
              resolve(); // resolve anyway
            };

            console.log('بدء تشغيل Web Speech API');
            speechSynthesis.speak(utterance);

            // timeout للأمان
            setTimeout(() => {
              console.log('انتهت مهلة Web Speech API، إيقاف التشغيل');
              speechSynthesis.cancel();
              resolve();
            }, 10000); // 10 ثوان كحد أقصى
          };

          // التحقق من تحميل الأصوات
          const voices = speechSynthesis.getVoices();
          if (voices.length === 0) {
            console.log('انتظار تحميل أصوات Web Speech API...');
            speechSynthesis.onvoiceschanged = () => {
              console.log('تم تحميل أصوات Web Speech API');
              speakText();
            };
            
            // timeout للحماية من الانتظار الطويل
            setTimeout(() => {
              console.log('انتهت مهلة انتظار الأصوات، محاولة التشغيل');
              speakText();
            }, 2000);
          } else {
            speakText();
          }

        } catch (error) {
          console.error('خطأ في Web Speech API:', error);
          resolve();
        }
      });
    }

    // دالة لإنشاء WAV header للـ PCM data
    createWavFile(pcmData, sampleRate, channels, bitsPerSample) {
      const byteRate = sampleRate * channels * bitsPerSample / 8;
      const blockAlign = channels * bitsPerSample / 8;
      const dataSize = pcmData.length;
      const fileSize = 36 + dataSize;

      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);

      // WAV header
      const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i));
        }
      };

      writeString(0, 'RIFF');
      view.setUint32(4, fileSize, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, channels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, byteRate, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, bitsPerSample, true);
      writeString(36, 'data');
      view.setUint32(40, dataSize, true);

      // PCM data
      const pcmView = new Uint8Array(buffer, 44);
      pcmView.set(pcmData);

      return buffer;
    }

    // دالة جديدة لاستخدام Speechify Streaming TTS (نفس النظام الرئيسي)
    async playStreamingTTS(text) {
      try {
        console.log('🎤 محاولة استخدام Speechify Streaming TTS للنص:', text.substring(0, 50) + '...');
        
        // تحويل النص إلى صوت عبر Speechify Streaming API
        const response = await fetch(`${this.config.baseUrl}/api/voice/text-to-speech/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: text,
            voiceId: this.botConfig?.voiceId || 'ar-male-1',
            agentId: this.agentId
          })
        });

        console.log('📡 استجابة Speechify Streaming TTS:', response.status, response.statusText);

        if (!response.ok) {
          const errorText = await response.text();
          
          if (response.status === 429 || errorText.includes('quota exceeded') || errorText.includes('quota')) {
            console.log('⚠️ تم تجاوز حصة Speechify API - التبديل إلى Web Speech API');
            throw new Error('Quota exceeded - using fallback');
          }
          
          console.error('❌ فشل طلب Speechify Streaming TTS:', {
            status: response.status,
            statusText: response.statusText,
            errorText: errorText
          });
          
          throw new Error(`Speechify Streaming TTS HTTP error! status: ${response.status}, message: ${errorText}`);
        }

        // التحقق من وجود body للـ streaming
        if (!response.body) {
          throw new Error('No response body for streaming');
        }

        console.log('📦 بدء استقبال Speechify Streaming TTS');

        // قراءة البيانات المتدفقة
        const reader = response.body.getReader();
        const chunks = [];
        let totalLength = 0;

        while (true) {
          const { done, value } = await reader.read();
          
          if (done) break;
          
          if (value) {
            chunks.push(value);
            totalLength += value.length;
            
            // حساب التقدم (تقديري)
            const estimatedProgress = Math.min(totalLength / (text.length * 100), 0.9);
            console.log(`تقدم التحميل: ${Math.round(estimatedProgress * 100)}%`);
          }
        }

        // دمج جميع الـ chunks
        const audioData = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          audioData.set(chunk, offset);
          offset += chunk.length;
        }

        console.log('✅ تم استقبال جميع بيانات Speechify Streaming TTS');

        // إنشاء Blob من البيانات الصوتية
        const blob = new Blob([audioData], { type: 'audio/mpeg' });
        const audioUrl = URL.createObjectURL(blob);

        console.log('🎵 بدء تشغيل Speechify Streaming TTS');
        // تشغيل الصوت وانتظار انتهائه
        await this.playAudioAndWait(audioUrl);
        URL.revokeObjectURL(audioUrl);
        console.log('🎉 تم تشغيل Speechify Streaming TTS بنجاح');
        
      } catch (error) {
        if (error.message && error.message.includes('quota')) {
          // لا نطبع خطأ مفصل لتجاوز الحصة
          console.log('🔄 التبديل إلى Web Speech API');
        } else {
          console.error('💥 خطأ في Speechify Streaming TTS:', {
            name: error.name,
            message: error.message,
            stack: error.stack
          });
        }
        // رمي الخطأ ليتم التعامل معه في المستوى الأعلى
        throw error;
      }
    }



    playAudioAndWait(audioUrl) {
      return new Promise((resolve) => {
        try {
          const audio = new Audio(audioUrl);

          audio.onended = () => {
            console.log('Welcome message finished playing');
            resolve();
          };

          audio.onerror = (error) => {
            console.error('Error playing welcome audio:', {
              error: error,
              audioUrl: audioUrl,
              errorType: error?.type || 'unknown',
              errorMessage: error?.message || 'No message available',
              audioReadyState: audio?.readyState,
              audioNetworkState: audio?.networkState
            });
            resolve(); // resolve anyway to continue
          };

          audio.onloadstart = () => {
            console.log('Audio loading started:', audioUrl);
          };

          audio.oncanplay = () => {
            console.log('Audio can start playing');
          };

          audio.onloadeddata = () => {
            console.log('Audio data loaded');
          };

          audio.play().catch(error => {
            console.error('Error starting audio playback:', {
              error: error,
              errorName: error?.name,
              errorMessage: error?.message,
              audioUrl: audioUrl,
              audioReadyState: audio?.readyState,
              audioNetworkState: audio?.networkState
            });
            resolve(); // resolve anyway to continue
          });
        } catch (error) {
          console.error('Error creating audio:', {
            error: error,
            errorName: error?.name,
            errorMessage: error?.message,
            audioUrl: audioUrl
          });
          resolve(); // resolve anyway to continue
        }
      });
    }

    startRecordingLoop() {
      // إيقاف التسجيل كل 3 ثوان ومعالجة الصوت
      this.recordingInterval = setInterval(() => {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
          this.mediaRecorder.stop();
          setTimeout(() => {
            if (this.mediaRecorder && this.widgetState === 'connected') {
              this.audioChunks = [];
              this.mediaRecorder.start();
            }
          }, 500);
        }
      }, 3000);
    }

    async processAudio() {
      if (this.audioChunks.length === 0) return;

      try {
        // تحويل الصوت إلى blob
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });

        // إرسال للمعالجة
        const formData = new FormData();
        formData.append('audio', audioBlob);
        formData.append('sessionId', this.sessionId);
        formData.append('agentId', this.agentId);
        formData.append('voiceId', this.botConfig?.voiceId || 'ar-male-1');

        const response = await fetch(`${this.config.baseUrl}/api/voice/process`, {
          method: 'POST',
          body: formData
        });

        const result = await response.json();

        if (result.success) {
          // تشغيل الرد الصوتي
          await this.playAudioResponse(result.data.audioUrl);

          // إرسال حدث للتحليلات
          this.trackEvent('message_processed', {
            userText: result.data.userText,
            botResponse: result.data.botResponse
          });
        }
      } catch (error) {
        console.error('Error processing audio:', error);
      }
    }

    async playAudioResponse(audioUrl) {
      return new Promise((resolve) => {
        try {
          console.log('🎵 محاولة تشغيل الصوت:', audioUrl.substring(0, 100) + '...');
          
          // التحقق من نوع الصوت (data URL أم ملف)
          const isDataUrl = audioUrl.startsWith('data:');
          
          console.log('🔍 نوع الصوت:', {
            isDataUrl: isDataUrl,
            urlStart: audioUrl.substring(0, 50)
          });
          
          // إنشاء عنصر الصوت
          const audio = new Audio();
          
          // إعداد الصوت
          if (isDataUrl) {
            // للـ data URLs، استخدم الـ URL مباشرة
            audio.src = audioUrl;
          } else {
            // للملفات، أضف timestamp لتجنب cache
            audio.src = audioUrl + '?t=' + Date.now();
          }
          
          audio.preload = 'auto';
          audio.crossOrigin = 'anonymous';
          
          // إضافة معالجات الأحداث
          audio.onloadstart = () => {
            console.log('📥 بدء تحميل الصوت');
          };
          
          audio.oncanplay = () => {
            console.log('✅ الصوت جاهز للتشغيل');
          };
          
          audio.onended = () => {
            console.log('🏁 انتهى تشغيل الصوت');
            resolve();
          };
          
          audio.onerror = (error) => {
            console.error('❌ خطأ في تشغيل الصوت:', {
              error: error,
              readyState: audio.readyState,
              networkState: audio.networkState,
              currentSrc: audio.currentSrc,
              duration: audio.duration,

              isDataUrl: isDataUrl
            });
 
            
            resolve(); // المتابعة حتى لو فشل التشغيل
          };
          
          // محاولة تشغيل الصوت
          const playPromise = audio.play();
          
          if (playPromise !== undefined) {
            playPromise.then(() => {
              console.log('🎶 بدأ تشغيل الصوت بنجاح');
            }).catch(error => {
              console.error('❌ فشل في تشغيل الصوت:', {
                name: error.name,
                message: error.message,
                readyState: audio.readyState,
                networkState: audio.networkState,
                
                isDataUrl: isDataUrl
              });
              
              resolve(); // المتابعة حتى لو فشل التشغيل
            });
          }
          
        } catch (error) {
          console.error('❌ خطأ في إنشاء عنصر الصوت:', {
            name: error.name,
            message: error.message,
            audioUrl: audioUrl.substring(0, 100)
          });
          resolve(); // المتابعة حتى لو فشل الإنشاء
        }
      });
    }

    startCallTimer() {
      this.callDuration = 0;
      this.callTimer = setInterval(() => {
        this.callDuration++;
        this.updateWidget(); // تحديث العداد
      }, 1000);
    }

    async endCall() {
      // إيقاف التسجيل
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.stop();
      }

      // إيقاف العداد والتسجيل المتكرر
      if (this.callTimer) {
        clearInterval(this.callTimer);
        this.callTimer = null;
      }

      if (this.recordingInterval) {
        clearInterval(this.recordingInterval);
        this.recordingInterval = null;
      }

      // إيقاف stream الميكروفون
      if (this.mediaRecorder && this.mediaRecorder.stream) {
        this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
      }

      this.updateWidgetState('ending');

      // إنهاء الجلسة في قاعدة البيانات إذا كان هناك جلسة نشطة
      if (this.sessionId) {
        try {
          const formData = new FormData();
          formData.append('sessionId', this.sessionId);

          await fetch(`${this.config.baseUrl}/api/voice/end`, {
            method: 'POST',
            body: formData
          });
        } catch (error) {
          console.error('Error ending session:', error);
        }
      }

      setTimeout(() => {
        this.resetWidget();
      }, 1500);

      // إرسال حدث للتحليلات
      this.trackEvent('call_ended');
    }

    resetWidget() {
      this.widgetState = 'idle';
      this.callDuration = 0;
      this.sessionId = null;
      this.audioChunks = [];

      if (this.callTimer) {
        clearInterval(this.callTimer);
        this.callTimer = null;
      }

      if (this.recordingInterval) {
        clearInterval(this.recordingInterval);
        this.recordingInterval = null;
      }

      if (this.mediaRecorder) {
        if (this.mediaRecorder.stream) {
          this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
        this.mediaRecorder = null;
      }

      this.updateWidget();
    }

    updateWidgetState(newState) {
      this.widgetState = newState;
      this.updateWidget();
    }

    trackEvent(eventName, data = {}) {
      // إرسال أحداث التحليلات
      if (typeof gtag !== 'undefined') {
        gtag('event', eventName, {
          custom_parameter_1: this.agentId,
          ...data
        });
      }
      
      // يمكن إضافة خدمات تحليلات أخرى هنا
    }

    // API عامة
    destroy() {
      // إيقاف العداد
      if (this.callTimer) {
        clearInterval(this.callTimer);
        this.callTimer = null;
      }

      // إيقاف تحديث التخصيص
      if (this.configUpdateInterval) {
        clearInterval(this.configUpdateInterval);
        this.configUpdateInterval = null;
      }

      // إزالة العناصر
      if (this.container && this.container.parentNode) {
        this.container.parentNode.removeChild(this.container);
      }

      // إزالة الستايل
      const style = document.getElementById('sanad-bot-styles');
      if (style) {
        style.remove();
      }

      // إعادة تعيين المتغيرات
      this.isInitialized = false;
      this.widgetState = 'idle';
      this.callDuration = 0;
      this.container = null;
      this.widget = null;
      this.endButton = null;
    }

    updateConfig(newConfig) {
      this.config = { ...this.config, ...newConfig };
      if (this.isInitialized) {
        this.destroy();
        this.render();
      }
    }
  }

  // إنشاء instance عام
  window.SanadBot = new SanadBot();

  // API للمطورين
  window.SanadBot.api = {
    startCall: () => window.SanadBot.startCall(),
    endCall: () => window.SanadBot.endCall(),
    getState: () => window.SanadBot.widgetState,
    destroy: () => window.SanadBot.destroy(),
    updateConfig: (config) => window.SanadBot.updateConfig(config)
  };

})();
