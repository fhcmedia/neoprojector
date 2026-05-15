package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"
)

const defaultMigrationsDir = "database/migrations"

func main() {
	var (
		dbPath   string
		dir      string
		verbose  bool
	)

	flag.StringVar(&dbPath, "db", "", "path to the sqlite database")
	flag.StringVar(&dir, "dir", defaultMigrationsDir, "directory with goose migration files")
	flag.BoolVar(&verbose, "v", false, "enable verbose goose output")
	flag.Parse()

	args := flag.Args()
	if len(args) == 0 {
		usage()
		os.Exit(2)
	}

	command := args[0]
	commandArgs := args[1:]

	if verbose {
		goose.SetVerbose(true)
	}

	if err := goose.SetDialect("sqlite3"); err != nil {
		log.Fatalf("set goose dialect: %v", err)
	}

	switch command {
	case "create", "fix":
		if err := goose.RunContext(context.Background(), command, nil, dir, commandArgs...); err != nil {
			log.Fatalf("goose %s: %v", command, err)
		}
		return
	}

	if dbPath == "" {
		log.Fatal("missing required -db flag")
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatalf("open sqlite db: %v", err)
	}
	defer db.Close()

	if err := goose.RunContext(context.Background(), command, db, dir, commandArgs...); err != nil {
		log.Fatalf("goose %s: %v", command, err)
	}
}

func usage() {
	fmt.Fprintf(flag.CommandLine.Output(), "Usage: %s -db path/to/db.sqlite [flags] <command> [args]\n", os.Args[0])
	fmt.Fprintln(flag.CommandLine.Output())
	fmt.Fprintln(flag.CommandLine.Output(), "Commands:")
	fmt.Fprintln(flag.CommandLine.Output(), "  up | up-by-one | up-to VERSION")
	fmt.Fprintln(flag.CommandLine.Output(), "  down | down-to VERSION | redo | reset")
	fmt.Fprintln(flag.CommandLine.Output(), "  status | version")
	fmt.Fprintln(flag.CommandLine.Output(), "  create NAME [sql] | fix")
	fmt.Fprintln(flag.CommandLine.Output())
	flag.PrintDefaults()
}
