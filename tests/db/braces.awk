{
  for (i=1; i<=length($0); i++) {
    c=substr($0,i,1)
    if (c=="{"||c=="}") printf "[%s]", c
  }
  print ""
}