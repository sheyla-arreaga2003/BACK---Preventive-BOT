ALTER TABLE USER_PREFERENCES
  MODIFY COLUMN UPAccentColor ENUM(
    'red',
    'blue',
    'purple',
    'green',
    'yellow',
    'orange',
    'sky',
    'pink'
  ) NOT NULL DEFAULT 'red';
