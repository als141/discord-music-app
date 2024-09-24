// sw.js

self.addEventListener('install', function (event) {
    console.log('Service Worker installing.');
  });
  
  self.addEventListener('activate', function (event) {
    console.log('Service Worker activating.');
  });
  
  // その他、キャッシュ戦略などを必要に応じて追加
  