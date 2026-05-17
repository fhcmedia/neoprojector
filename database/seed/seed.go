package seed

import (
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/charmbracelet/log"
)

//go:embed *.json
var dataFS embed.FS

// Shape of the embedded bible JSON seed files.
type jsonBible struct {
	Translation string          `json:"translation"`
	Books       []jsonBibleBook `json:"books"`
}

type jsonBibleBook struct {
	Name     string             `json:"name"`
	Chapters []jsonBibleChapter `json:"chapters"`
}

type jsonBibleChapter struct {
	Chapter int              `json:"chapter"`
	Verses  []jsonBibleVerse `json:"verses"`
}

type jsonBibleVerse struct {
	Verse int    `json:"verse"`
	Text  string `json:"text"`
}

type bibleConfig struct {
	File        string // 'kjv.json'
	Translation string // stored in bible.translation
	Name        string // display name
	Language    string // 'en', 'ru'
}

type bibleBookSeed struct {
	Name    string // canonical DB key from the source JSON
	NameKJV string // English display label
	NameRST string // Russian display label
}

type bibleBookCategoryRange struct {
	From     int
	To       int
	Category string
}

var bibleBooks = parseBibleBooksTable(`
Genesis            | Genesis            | Бытие
Exodus             | Exodus             | Исход
Leviticus          | Leviticus          | Левит
Numbers            | Numbers            | Числа
Deuteronomy        | Deuteronomy        | Второзаконие
Joshua             | Joshua             | Иисус Навин
Judges             | Judges             | Судьи
Ruth               | Ruth               | Руфь
I Samuel           | 1 Samuel           | 1 Царств
II Samuel          | 2 Samuel           | 2 Царств
I Kings            | 1 Kings            | 3 Царств
II Kings           | 2 Kings            | 4 Царств
I Chronicles       | 1 Chronicles       | 1 Паралипоменон
II Chronicles      | 2 Chronicles       | 2 Паралипоменон
Ezra               | Ezra               | Ездра
Nehemiah           | Nehemiah           | Неемия
Esther             | Esther             | Есфирь
Job                | Job                | Иов
Psalms             | Psalms             | Псалтирь
Proverbs           | Proverbs           | Притчи
Ecclesiastes       | Ecclesiastes       | Екклесиаст
Song of Solomon    | Song of Solomon    | Песнь Песней
Isaiah             | Isaiah             | Исаия
Jeremiah           | Jeremiah           | Иеремия
Lamentations       | Lamentations       | Плач Иеремии
Ezekiel            | Ezekiel            | Иезекииль
Daniel             | Daniel             | Даниил
Hosea              | Hosea              | Осия
Joel               | Joel               | Иоиль
Amos               | Amos               | Амос
Obadiah            | Obadiah            | Авдий
Jonah              | Jonah              | Иона
Micah              | Micah              | Михей
Nahum              | Nahum              | Наум
Habakkuk           | Habakkuk           | Аввакум
Zephaniah          | Zephaniah          | Софония
Haggai             | Haggai             | Аггей
Zechariah          | Zechariah          | Захария
Malachi            | Malachi            | Малахия
Matthew            | Matthew            | От Матфея
Mark               | Mark               | От Марка
Luke               | Luke               | От Луки
John               | John               | От Иоанна
Acts               | Acts               | Деяния
Romans             | Romans             | К Римлянам
I Corinthians      | 1 Corinthians      | 1 Коринфянам
II Corinthians     | 2 Corinthians      | 2 Коринфянам
Galatians          | Galatians          | К Галатам
Ephesians          | Ephesians          | К Ефесянам
Philippians        | Philippians        | К Филиппийцам
Colossians         | Colossians         | К Колоссянам
I Thessalonians    | 1 Thessalonians    | 1 Фессалоникийцам
II Thessalonians   | 2 Thessalonians    | 2 Фессалоникийцам
I Timothy          | 1 Timothy          | 1 Тимофею
II Timothy         | 2 Timothy          | 2 Тимофею
Titus              | Titus              | Титу
Philemon           | Philemon           | Филимону
Hebrews            | Hebrews            | К Евреям
James              | James              | Иакова
I Peter            | 1 Peter            | 1 Петра
II Peter           | 2 Peter            | 2 Петра
I John             | 1 John             | 1 Иоанна
II John            | 2 John             | 2 Иоанна
III John           | 3 John             | 3 Иоанна
Jude               | Jude               | Иуды
Revelation of John | Revelation         | Откровение
`)

// Category is a stable backend key. The frontend can map it to colors later.
var bibleBookCategoryRanges = []bibleBookCategoryRange{
	{From: 1, To: 5, Category: "law"},
	{From: 6, To: 17, Category: "history"},
	{From: 18, To: 22, Category: "poetry"},
	{From: 23, To: 27, Category: "major_prophets"},
	{From: 28, To: 39, Category: "minor_prophets"},
	{From: 40, To: 43, Category: "gospels"},
	{From: 44, To: 44, Category: "history"},
	{From: 45, To: 57, Category: "letters"},
	{From: 58, To: 65, Category: "letters"},
	{From: 66, To: 66, Category: "prophecy"},
}

func parseBibleBooksTable(data string) []bibleBookSeed {
	lines := strings.Split(strings.TrimSpace(data), "\n")
	books := make([]bibleBookSeed, 0, len(lines))

	for _, line := range lines {
		parts := strings.Split(line, "|")
		if len(parts) != 3 {
			panic("invalid bibleBooks row: " + line)
		}

		books = append(books, bibleBookSeed{
			Name:    strings.TrimSpace(parts[0]),
			NameKJV: strings.TrimSpace(parts[1]),
			NameRST: strings.TrimSpace(parts[2]),
		})
	}

	return books
}

func bibleBookCategory(position int) (string, error) {
	for _, category := range bibleBookCategoryRanges {
		if position >= category.From && position <= category.To {
			return category.Category, nil
		}
	}

	return "", fmt.Errorf("bible book position %d falls outside any known category range", position)
}

var bibles = []bibleConfig{
	{
		File:        "kjv.json",
		Translation: "KJV",
		Name:        "King James Version",
		Language:    "en",
	},
	{
		File:        "rst.json",
		Translation: "RST",
		Name:        "Russian Synodal Translation",
		Language:    "ru",
	},
}

func Seed(db *sql.DB, progress func(string, int)) error {
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM bible").Scan(&count); err != nil {
		return fmt.Errorf("check seed state: %w", err)
	}
	if count > 0 {
		log.Info("already seeded, skipping")
		return nil
	}

	for _, b := range bibles {
		if _, err := db.Exec(
			"INSERT INTO bible (translation, name, language) VALUES (?, ?, ?)",
			b.Translation, b.Name, b.Language,
		); err != nil {
			return fmt.Errorf("insert bible %s: %w", b.Translation, err)
		}
	}

	for i, book := range bibleBooks {
		cat, err := bibleBookCategory(i + 1)
		if err != nil {
			return fmt.Errorf("categorize bible_book %s: %w", book.Name, err)
		}
		if _, err := db.Exec(
			"INSERT INTO bible_book (name, position, category, name_kjv, name_rst) VALUES (?, ?, ?, ?, ?)",
			book.Name, i+1, cat, book.NameKJV, book.NameRST,
		); err != nil {
			return fmt.Errorf("insert bible_book %s: %w", book.Name, err)
		}
	}

	for ti, b := range bibles {
		progress(fmt.Sprintf("Seeding %s...", b.Name), 35+ti*50/len(bibles))

		data, err := dataFS.ReadFile(b.File)
		if err != nil {
			return fmt.Errorf("read %s: %w", b.File, err)
		}

		var bibleData jsonBible
		if err := json.Unmarshal(data, &bibleData); err != nil {
			return fmt.Errorf("unmarshal %s: %w", b.File, err)
		}

		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("begin tx: %w", err)
		}

		stmt, err := tx.Prepare(
			"INSERT INTO bible_verse (translation, book, chapter, verse, text) VALUES (?, ?, ?, ?, ?)",
		)
		if err != nil {
			tx.Rollback()
			return fmt.Errorf("prepare stmt: %w", err)
		}

		verseCount := 0
		for _, book := range bibleData.Books {
			for _, chapter := range book.Chapters {
				for _, verse := range chapter.Verses {
					if _, err := stmt.Exec(b.Translation, book.Name, chapter.Chapter, verse.Verse, verse.Text); err != nil {
						stmt.Close()
						tx.Rollback()
						return fmt.Errorf("insert verse: %w", err)
					}
					verseCount++
				}
			}
		}

		if err := stmt.Close(); err != nil {
			tx.Rollback()
			return fmt.Errorf("close stmt: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit tx: %w", err)
		}

		log.Info("seeded verses", "count", verseCount)
	}

	return nil
}
