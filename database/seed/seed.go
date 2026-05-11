package seed

import (
	"embed"
	"strings"
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
Revelation of John | Revelation         | Откровение Иоанна Богослова
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

func bibleBookCategory(position int) string {
	for _, category := range bibleBookCategoryRanges {
		if position >= category.From && position <= category.To {
			return category.Category
		}
	}

	panic("invalid bible book position")
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
