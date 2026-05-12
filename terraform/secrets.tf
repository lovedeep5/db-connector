# Stored in the standard RDS-secret JSON shape so AWS-native rotation works
# out of the box if you ever turn it on. The connection URL is also added as
# a convenience field; the app reads `url`.
resource "aws_secretsmanager_secret" "db" {
  name                    = "${local.name}/metadata/database"
  description             = "PostgreSQL credentials for dbconnector metadata DB"
  recovery_window_in_days = 0 # immediate delete on `terraform destroy`
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    engine   = "postgres"
    host     = aws_db_instance.this.address
    port     = aws_db_instance.this.port
    dbname   = aws_db_instance.this.db_name
    username = aws_db_instance.this.username
    password = random_password.db.result
    url      = "postgresql://${aws_db_instance.this.username}:${urlencode(random_password.db.result)}@${aws_db_instance.this.address}:${aws_db_instance.this.port}/${aws_db_instance.this.db_name}?sslmode=require"
  })
}
