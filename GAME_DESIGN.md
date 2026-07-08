# Vampire Survivors Battle Arena - Game Design Document

## 1. Oyun Konsepti
**Türü:** Real-time Action PvP  
**Oyuncu Sayısı:** 2 oyuncu (1v1)  
**Tema:** Karanlık fantezi - oyuncular karşılıklı güçlendirilmiş yaratıklar döklüyerek kazanmaya çalışırlar

### 1.1 Erişim: Davet Kodu Sistemi
⚠️ **ÖNEMLİ:** Oyuna girmek için davet kodu gereklidir.
- Host oyuncu 4-karakterli kod üretir
- Diğer oyuncu kodu girer → oyuna katılır
- Özel session'lar (private games)
- Kod timeout: 15 dakika veya oyun bitince

---

## 2. Temel Oyun Loop (15-30 dakika)

### 2.0 Kontroller & Hareket (ÇOK ÖNEMLİ)
- **Hareket:** Oyuncu SADECE sağa/sola hareket eder (A/D veya ←/→)
- **Saldırı:** %100 otomatik — tıklama, nişan alma, manuel kontrol YOK
- **Etkileşim:** Sadece satıcı ile etkileşim (satıcının yanına gidip menü açma)
- **Hasar Alma:** Yaratıklar oyuncunun bedenine çarparsa temas hasarı verir

### 2.1 Yaratık Sistemi
- **Spawn:** Harita üzerinde belirli zaman aralıklarında rastgele yaratıklar spawn olur
- **Türler:** Orc, Soldier, Demon, Blood Monster (hazır pixel art assetler)
- **Oyuncu Aksiyonu:** Silahlar menzildeki yaratıklara otomatik vurur

### 2.1.1 ⚔️ Çekirdek PvP Mekaniği: Kill = Rakibe Spawn
**Her kesilen yaratık, öldüğünde KARŞI TAKIMIN tarafında 2 yaratık spawn ettirir.**
- Ne kadar çok kesersen, rakibin o kadar boğulur
- Ama kesmezsen XP/altın kazanamazsın → güçlenemezsin
- Bu döngü oyunun kalbini oluşturur: agresif farm = rakibe baskı

#### Yaratık Stats

| Stat | Açıklama | Örnek |
|------|----------|-------|
| **HP** | Yaratığın canı | Zombi: 20, Ejderha: 100 |
| **Damage** | Oyuncuya verdiği hasar | Zombi: 2, Şövalye: 5 |
| **Speed** | Hareket hızı (pixel/sn) | Küçük: 50, Ejderha: 80 |
| **Gold Drop** | Kesince verdiği altın | Zombi: 5, Ejderha: 50 |
| **XP Drop** | Kesince verdiği XP | Zombi: 10, Ejderha: 100 |

### 2.2 Kazanç Sistemi

| Aksiyon | Ödül |
|---------|------|
| Yaratık Kes | +5-20 Altın (yaratık türüne göre) |
| Yaratık Kes | +10 XP (yaratık türüne göre) |
| Satıcı Satın Al (Nerf Item) | -50-200 Altın |

### 2.3 Level Up & Silah/Kitap Seçimi

**Level Up Tetikleyicisi:**
- Her yaratığı kesin +XP kazanır
- XP dolunca → Level Up (otomatik)
- Oyun duraklar, seçim menüsü açılır

**Seçim Mekanizması:**
Her level up'ta **2 seçenek** sunulur:
1. **Mevcut Silahı Güçlendir** (varsa)
   - Hasar +20%, Hız +10%, Etki +15%
   - Silah seç → Seç güclendir

2. **Yeni Silah Al** (maksimum 4)
   - 3 random silah seçeneği
   - Eğer 4 silah varsa, birisini değiş

3. **Kitap Seç** (maksimum 4)
   - 3 random kitap seçeneği
   - Aynı kitaptan seçersen +1 seviye

**Inventory Limiti:**
- ⚠️ **Max 4 Silah**
- ⚠️ **Max 4 Kitap**
- Sınıra ulaştığında eski silah/kitap seçerek değiştirebilir

#### Silahlar (Otomatik Vurur) - Max 4 Silah

| Silah | Hasar | Etki | Açıklama |
|-------|-------|------|----------|
| **AoE Çevirmen** | 10 | Area | Etrafta dönen hasar alanı |
| **Keskin Bıçak** | 15 | Directional | Önüne doğru bıçak vurur |
| **Yavaşlatıcı Dondu** | 5 | Slow | Yaratıkları %50 yavaşlatır (2sn) |
| **Ateş Yağmuru** | 20 | Burn | Yaratıkları yakar (8 hasar/sn, 3sn) |
| **Şimşek Zinciri** | 25 | Homing | Avına güdümlü şimşek çakar |
| **Turret Fabrikası** | 30 | Stationary | Turret koyar (8sn ömür, 3 tane max) |
| **İmpaktor** | 35 | Single | Tek büyük vuruş (ağır) |
| **Çok Keskin** | 8 | Rapid | Çok hızlı küçük vuruşlar |

#### Kitaplar (Stat Güçlendirmesi)

| Kitap | Seviye | Etki | Açıklama |
|-------|--------|------|----------|
| **Keskinlik Tomografı** | +1 | +15% Damage | Tüm silahların hasarı artar |
| **Hız Elması** | +1 | +10% Hareket Hızı | Karakter daha hızlı hareket eder |
| **Saldırı İçgüdüsü** | +1 | +12% Saldırı Hızı | Silah saldırı hızı artar |
| **Çok Atış Kitabı** | +1 | +1 Projectile | Silahlar 1 ek projectile atış yapar |
| **Kritik Aydınlama** | +1 | +15% Crit Şansı | Kritik vuruş şansı artar |
| **Kalkan Ruhu** | +1 | +10 Armor/Defense | Aldığı hasar -10% azalır |
| **Yaşam Kaynağı** | +1 | +20 Max HP | Maksimum can artar |
| **Spawn Hızlandırıcı** | +1 | +15% Spawn Hızı | Yaratıklar daha hızlı spawn olur (rakibi zor duruma düşürür) |
| **Çift Keskinlik** | +2 | +25% Damage | Üst seviye damage buff |
| **Tanrı Hızı** | +2 | +20% Hareket Hızı | Üst seviye hız buff |

**Kitap Mekanikası:**
- Her level up'ta 3 random kitap seçeneği sunulur
- Aynı kitabı seçersen seviyesi +1 artar (stacking)
- Her seviye daha iyi bonus verir

---

## 3. Oyuncu Rekabeti

### 3.1 Kendi Sabitasını Güçlendir
- **Inventory Açma:** Altınla chest açıp item alır (passive stat bonusları)
- Örnek: +50 HP, +10% Damage, +1 Armor

### 3.2 Rakibi Zayıflat (Satıcı Mekanikası)
**Harita Kenarında Satıcı:**
- Rakibin işini zorlaştıracak güçlendirmeler satın alır
- **Örnek Nerf Items:**
  - **Yaratık Yağmuru:** Rakibinin haritasında 5 saniye extra yaratık spawn (100 altın)
  - **Ağırlaştırma:** Rakibinin hızı -30% (80 altın, 8 sn)
  - **Zayıflama:** Rakibinin hasar -20% (120 altın, 10 sn)
  - **Kargo Kaybı:** Rakibinin altınını çal (150 altın, %30 rakibinin altını al)
  - **Hastalık:** Rakibinin crit şansı -50% (90 altın, 6 sn)

---

## 4. HP & Sağlık Sistemi

- **Başlangıç HP:** 100
- **Yaratık Hasarı:** Yaratık oyuncuya değerse -5 HP/sn (yaratık türüne göre değişebilir)
- **Healing:** Belirli itemler/kitaplar HP restore edebilir (optional)

---

## 5. Galip Olma Koşulu

**Rakip oyuncunun HP'si 0'a düşerse oyuncu kazanır.**  
- Oyun süresi: 10-50 dakika (oyuncuların başarısı ve savunmasına bağlı)
- Hızlı oyunlar: Aggressive oyuncular rakibi hızlı öldürür
- Uzun oyunlar: İki oyuncu iyi defense yapıyorsa uzun sürer

---

## 6. UI & Harita Layout

```
┌─────────────────────────────────────┐
│ Oyuncu1 (Lvl: 15) | Oyuncu2 (Lvl: 12) │
│ Para: 500 | XP: 80/100             │
├─────────────────────────────────────┤
│                                     │
│         [🧛 OYUNCU 1]               │
│         Yaratıklar                  │
│                                     │
│   [SATICI]                          │
│   - Yaratık Yağmuru: 100           │
│   - Ağırlaştırma: 80               │
│                                     │
│         [🧟 OYUNCU 2]               │
│         Yaratıklar                  │
│                                     │
└─────────────────────────────────────┘
```

---

## 7. Teknik Bilgiler

**Platform:** Web (Node.js + Socket.io)  
**Frontend:** JavaScript/React  
**Grafik:** 2D (Pixel Art veya Simple Shapes)  
**Fizik:** Kolay çarpışma algılama

---

## 8. Oyun Stratejisi

- **Offensive:** Agresif oyuncu rakibine yaratık yağmuru, zayıflama satın alır
- **Defensive:** Korumacı oyuncu HP/armor itemleri alır, kendini güçlendirir
- **Balanced:** İkisini dengeli kullanır

---

## 9. Scaling & Progression Sistemi

⚠️ **KRITIK:** Oyun derin olmalı! Sayılar 100K → 1M range'inde scale olabilmeli.

### 9.1 Damage Scaling (Oyuncu Silahları)
```
Lvl 1:    4 damage
Lvl 10:   ~20 damage
Lvl 50:   ~500 damage
Lvl 100:  ~5,000 damage
Lvl 200:  ~50,000 damage
Lvl 300:  ~500,000 damage

Formula: BaseDamage * (1.08 ^ Level) * BookMultiplier
BookMultiplier: 0.8x → 5x (kitaplar ile)
Range: 4 → 2,000,000+ damage
```

### 9.2 Yaratık HP Scaling
```
Lvl 1:    100 HP
Lvl 10:   ~300 HP
Lvl 50:   ~10,000 HP
Lvl 100:  ~100,000 HP (MAX for creatures)
Lvl 200:  ~1,000,000 HP (rakibinin canı)

Formula: BaseHP * (1.07 ^ Level)
Range: 100 → 100,000 HP
```

### 9.3 Oyuncu HP (Character HP)
```
Başlangıç: 100 HP
Max Level: 1,000,000 HP (Level 300+)

Formula: 100 + (50 * Level) + BookBonus
BookBonus: Yaşam Kitabı ile +20 HP per level
```

### 9.4 Reward Scaling
```
Gold Drop: (Lvl * 2) + BaseGold
XP Drop: (Lvl * 3) + BaseXP
Örnek: Lvl 100 → +200 gold, +300 XP per creature kill
```

### 9.5 Yaratık Spawn Hızı
```
Lvl 1:    1 yaratık/3 sn
Lvl 50:   ~8 yaratık/sn
Lvl 100:  ~15 yaratık/sn (HARD)
Lvl 200:  ~40+ yaratık/sn (INSANE)

Formula: 0.33 + (Lvl * 0.15) spawns/sn
Zorluk exponential olarak artar!
```

### 9.6 Balance Kuralları
- ⚠️ **Sürekli zorluk artar:** Spawn hızı, HP artar
- ⚠️ **Oyuncu scalable:** Silahlar + kitaplar ile düşman'ı tutmalı
- ⚠️ **Satıcı önemli:** Rakibini zayıflatmak survive'ı sağlar
- ⚠️ **Timing:** Erken güçlendirmeler geç oyunda kritik

## 10. Başlangıç Tasarımı ✅

**HP Sistemi:** ✅ Eklendi  
**Galip Koşulu:** ✅ HP = 0 ölüm  
**Oyun Süresi:** ✅ 10-50 dakika (değişken)
**Davet Kodu:** ✅ Gerekli - private sessions
**Scaling:** ✅ Derin progression sistemi

